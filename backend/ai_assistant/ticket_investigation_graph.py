"""Durable Planner-to-Worker ticket investigation workflow.

This is the session-level LangGraph.  Individual role turns still use the
existing LangChain chat agent, model selection, tool policy, approvals, and
audit recording.  The database remains the source of truth so a transcript is
available even if the in-process graph runner stops.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Any, TypedDict
import json

from django.contrib.auth import get_user_model
from django.db import close_old_connections, transaction
from langchain_core.tools import StructuredTool, ToolException
from langgraph.graph import END, START, StateGraph
from jsonschema import validate, ValidationError

from .chat_errors import safe_chat_error
from .models import TicketInvestigationGoal, TicketInvestigationMessage, TicketInvestigationRun
from .ticket_investigation_agent import run_investigation_turn
from .ticket_investigation_runtime import event, record_trace
from .ticket_investigation_contracts import (
    planner_contract_tools, worker_settlement_tools, pending_results, evidence_fingerprint,
    findings, tool, TEXT, PLAN_ROW,
)


class InvestigationState(TypedDict, total=False):
    session_id: str
    planner_id: str
    actor_id: int
    initial_message: str
    overrides: dict[str, Any]
    model_guard: Any
    phase: str
    current_worker_id: str | None


# The graph is an ordered Planner → Worker → Planner loop, so it uses one
# process-local runner rather than treating every delegated direction as a
# parallel job. Worker count is not capped by this executor.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ticket-investigation-graph")
_IN_FLIGHT: set[str] = set()
_IN_FLIGHT_LOCK = Lock()


def _is_active(run: TicketInvestigationRun) -> bool:
    return run.status not in {"paused", "cancelled"}


def _record_failure(run: TicketInvestigationRun, actor, exc: Exception) -> None:
    if run.status == "cancelled":
        return
    diagnostic = safe_chat_error(exc)
    TicketInvestigationMessage.objects.create(
        session=run.session,
        run=run,
        created_by=actor,
        role="system",
        content=diagnostic["message"],
    )
    run.status = "failed"
    run.save(update_fields=["status", "updated_at"])
    event(session=run.session, run=run, event_type="role_failed", title=f"{run.title} failed", content=diagnostic["message"])


def _planner_tools(planner: TicketInvestigationRun, actor) -> list[StructuredTool]:
    """Return durable goal and intent mutations available only to the Planner."""

    def create_worker_task(title: str, objective: str, question_key: str, source_key: str, method_key: str, plan: dict | None = None) -> dict[str, str]:
        clean_title = str(title or "").strip()
        clean_objective = str(objective or "").strip()
        if not 1 <= len(clean_title) <= 180:
            raise ToolException("Worker title must contain 1-180 characters.")
        if not 1 <= len(clean_objective) <= 4000:
            raise ToolException("Worker objective must contain 1-4000 characters.")
        if plan is not None:
            try:
                validate(plan, PLAN_ROW)
            except ValidationError:
                raise ToolException("Supply a valid investigation plan row.") from None

        with transaction.atomic():
            current = TicketInvestigationRun.objects.select_related("session").select_for_update().get(id=planner.id)
            if current.status in {"paused", "cancelled"}:
                raise ToolException("The Planner is paused or cancelled; it cannot create new Worker tasks.")
            if pending_results(current.session):
                raise ToolException("Consume pending Worker results before creating new work.")
            assignment = {key: " ".join(value.casefold().split()) for key, value in {
                "question_key": question_key, "source_key": source_key, "method_key": method_key,
            }.items()}
            if any(not value or len(value) > 240 for value in assignment.values()):
                raise ToolException("Question, source and method keys must be nonempty and at most 240 characters.")
            for existing in current.session.runs.filter(role="worker"):
                if existing.synthesis.get("assignment") == assignment:
                    raise ToolException(f"This question/source/method already has Worker {existing.id}. Read its result; change the source or method only for a material reason.")
            worker = TicketInvestigationRun.objects.create(
                session=current.session,
                parent=current,
                created_by=actor,
                role="worker",
                title=clean_title,
                objective=clean_objective,
                synthesis={"assignment": assignment, **({"plan": plan} if plan is not None else {})},
            )
            event(session=current.session, run=current, event_type="intent_created", title=f"Worker task created: {clean_title}",
                  content=clean_objective, payload={"worker_id": str(worker.id), **({"plan": plan} if plan is not None else {})})
        return {
            "worker_id": str(worker.id),
            "status": worker.status,
            "message": "Worker task was added to this investigation session's queue.",
        }

    worker_tool = StructuredTool(
        name="create_worker_task",
        description=(
            "Create one durable Worker task for a distinct investigation direction. "
            "The scheduler will run queued tasks one at a time and return each Worker result to Planner. "
            "Use a title and an objective that names the evidence target, scope, and completion condition."
        ),
        args_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": 180},
                "objective": {"type": "string", "minLength": 1, "maxLength": 4000},
                "question_key": {"type": "string", "minLength": 1, "maxLength": 240},
                "source_key": {"type": "string", "minLength": 1, "maxLength": 240},
                "method_key": {"type": "string", "minLength": 1, "maxLength": 240},
                "plan": PLAN_ROW,
            },
            "required": ["title", "objective", "question_key", "source_key", "method_key"],
            "additionalProperties": False,
        },
        func=create_worker_task,
        metadata={"source": "internal", "tool_name": "create_worker_task"},
        handle_tool_error=True,
    )

    def define_goal(title: str, acceptance_criteria: str) -> dict[str, str]:
        clean_title = str(title or "").strip()
        clean_criteria = str(acceptance_criteria or "").strip()
        if not 1 <= len(clean_title) <= 500 or not len(clean_criteria) <= 4000:
            raise ToolException("Goal title must contain 1-500 characters and acceptance criteria at most 4000 characters.")
        with transaction.atomic():
            current = TicketInvestigationRun.objects.select_related("session").select_for_update().get(id=planner.id)
            if current.status in {"paused", "cancelled"}:
                raise ToolException("The Planner is paused or cancelled; it cannot define goals.")
            goal = TicketInvestigationGoal.objects.create(session=current.session, created_by=actor, title=clean_title, acceptance_criteria=clean_criteria)
            event(session=current.session, run=current, event_type="goal_defined", title=f"Goal defined: {clean_title}",
                  content=clean_criteria, payload={"goal_id": str(goal.id)})
        return {"goal_id": str(goal.id), "status": goal.status, "message": "Goal and acceptance criteria were saved."}

    goal_tool = StructuredTool(
        name="define_investigation_goal",
        description="Save one user-relevant investigation goal and its concrete acceptance criteria. Goals are durable planning records, not evidence or completed work.",
        args_schema={"type": "object", "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 500},
            "acceptance_criteria": {"type": "string", "maxLength": 4000},
        }, "required": ["title", "acceptance_criteria"], "additionalProperties": False},
        func=define_goal, metadata={"source": "internal", "tool_name": "define_investigation_goal"}, handle_tool_error=True,
    )
    return [goal_tool, worker_tool, *planner_contract_tools(planner, actor)]


def _planner(state: InvestigationState) -> dict[str, Any]:
    close_old_connections()
    try:
        planner = TicketInvestigationRun.objects.select_related("session__ticket").get(
            id=state["planner_id"], session_id=state["session_id"], role="planner",
        )
        actor = get_user_model().objects.get(pk=state["actor_id"])
        if not _is_active(planner):
            return {"phase": "halt"}

        handoff = state.get("phase") == "worker_handoff"
        message = state["initial_message"]
        if handoff:
            worker = TicketInvestigationRun.objects.filter(id=state.get("current_worker_id"), session=planner.session).first()
            worker_title = worker.title if worker else "the latest Worker"
            message = (
                f"Worker {worker.id if worker else ''} ({worker_title}) returned a saved result. "
                f"Actual result: {json.dumps(worker.result if worker else {}, ensure_ascii=False)}. "
                "Consume it with synthesize_worker_result (empty findings for evidence gaps), update the plan, and create any further Worker tasks needed "
                "to answer unresolved investigation directions. If the evidence is sufficient, summarize "
                "the current direction and do not create unnecessary work."
            )
            TicketInvestigationMessage.objects.create(
                session=planner.session,
                run=planner,
                created_by=actor,
                role="system",
                content=f"Worker handoff received from {worker_title}.",
            )

        planner.status = "running"
        planner.result = {}
        planner.save(update_fields=["status", "result", "updated_at"])
        event(session=planner.session, run=planner, event_type="planner_started", title="Planner pass started", content=message)
        result = run_investigation_turn(
            run=planner,
            actor=actor,
            message=message,
            overrides=state["overrides"],
            model_guard=state.get("model_guard"),
            extra_tools=_planner_tools(planner, actor),
        )
        planner.refresh_from_db()
        if not _is_active(planner):
            return {"phase": "halt"}
        assistant_message = TicketInvestigationMessage.objects.create(
            session=planner.session,
            run=planner,
            created_by=actor,
            role="assistant",
            content=str(result.get("response") or "No response was returned."),
            trace=result.get("trace") or [],
        )
        record_trace(session=planner.session, run=planner, message=assistant_message, trace=result.get("trace"))
        planner.refresh_from_db()
        if pending_results(planner.session) or not planner.result.get("action"):
            raise RuntimeError("Planner did not consume pending results and save a next-step decision; durable records are retained for resume.")
        if planner.result["action"] == "continue_investigation" and not planner.session.runs.filter(role="worker", status="open").exists():
            raise RuntimeError("Planner chose to continue but queued no distinct work.")
        planner.status = "completed"
        planner.save(update_fields=["status", "updated_at"])
        return {"phase": "review" if planner.result["action"] == "final_report" else "waiting" if planner.result["action"] == "wait_for_input" else "schedule"}
    except Exception as exc:
        try:
            planner = TicketInvestigationRun.objects.get(id=state["planner_id"])
            actor = get_user_model().objects.get(pk=state["actor_id"])
            _record_failure(planner, actor, exc)
        except TicketInvestigationRun.DoesNotExist:
            pass
        return {"phase": "halt"}
    finally:
        close_old_connections()


def _next_worker(state: InvestigationState) -> dict[str, Any]:
    close_old_connections()
    try:
        with transaction.atomic():
            planner = TicketInvestigationRun.objects.select_related("session").select_for_update().get(
                id=state["planner_id"], session_id=state["session_id"], role="planner",
            )
            if not _is_active(planner):
                return {"phase": "halt", "current_worker_id": None}
            worker = (
                TicketInvestigationRun.objects.select_for_update()
                .filter(session=planner.session, parent=planner, role="worker", status="open")
                .order_by("created_at", "id")
                .first()
            )
            if worker is None:
                return {"phase": "done", "current_worker_id": None}
            worker.status = "running"
            worker.save(update_fields=["status", "updated_at"])
            event(session=planner.session, run=worker, event_type="intent_started", title=f"Worker started: {worker.title}", content=worker.objective)
            return {"phase": "worker", "current_worker_id": str(worker.id)}
    except TicketInvestigationRun.DoesNotExist:
        return {"phase": "halt", "current_worker_id": None}
    finally:
        close_old_connections()


def _worker(state: InvestigationState) -> dict[str, Any]:
    close_old_connections()
    try:
        worker = TicketInvestigationRun.objects.select_related("session__ticket", "parent").get(
            id=state["current_worker_id"], session_id=state["session_id"], role="worker",
        )
        actor = get_user_model().objects.get(pk=state["actor_id"])
        if not _is_active(worker):
            return {"phase": "worker_handoff"}
        instruction = (
            "Execute the assigned investigation direction now. Use the existing authorized tools when they "
            "materially help. Return evidence-backed findings, gaps, and a precise handoff for the Planner."
        )
        event(session=worker.session, run=worker, event_type="worker_started", title=f"Worker pass started: {worker.title}", content=instruction)
        TicketInvestigationMessage.objects.create(
            session=worker.session, run=worker, created_by=actor, role="user", content=instruction,
        )
        result = run_investigation_turn(
            run=worker,
            actor=actor,
            message=instruction,
            overrides=state["overrides"],
            model_guard=state.get("model_guard"),
        )
        worker.refresh_from_db()
        if not _is_active(worker):
            return {"phase": "halt"}
        if worker.status != "cancelled":
            assistant_message = TicketInvestigationMessage.objects.create(
                session=worker.session,
                run=worker,
                created_by=actor,
                role="assistant",
                content=str(result.get("response") or "No response was returned."),
                trace=result.get("trace") or [],
            )
            record_trace(session=worker.session, run=worker, message=assistant_message, trace=result.get("trace"))
            settlement = run_investigation_turn(
                run=worker, actor=actor,
                message="Settle the result you just saved using resolve_worker_result. Read your saved record for exact receipt IDs. "
                        "Use answered only if the assigned question is answered with evidence. Otherwise blocked for unavailable sources/errors "
                        "or exhausted for a budget limit. Do not collect again. Your structured result must preserve the conclusion and precise gaps.",
                overrides=state["overrides"], model_guard=state.get("model_guard"),
                extra_tools=worker_settlement_tools(worker, actor), records_only=True,
            )
            settlement_message = TicketInvestigationMessage.objects.create(
                session=worker.session, run=worker, created_by=actor, role="assistant",
                content=str(settlement.get("response") or "Worker result settlement recorded."), trace=settlement.get("trace") or [],
            )
            record_trace(session=worker.session, run=worker, message=settlement_message, trace=settlement.get("trace"))
            worker.refresh_from_db()
            if not worker.result.get("outcome"):
                raise RuntimeError("Worker returned dialogue without settling its structured result.")
            worker.status = {"answered": "completed", "blocked": "blocked", "exhausted": "exhausted"}[worker.result["outcome"]]
            worker.save(update_fields=["status", "updated_at"])
            event(session=worker.session, run=worker, message=assistant_message, event_type="intent_settled", title=f"Worker {worker.status}: {worker.title}")
    except TicketInvestigationRun.DoesNotExist:
        return {"phase": "halt"}
    except Exception as exc:
        try:
            worker = TicketInvestigationRun.objects.get(id=state["current_worker_id"])
            actor = get_user_model().objects.get(pk=state["actor_id"])
            _record_failure(worker, actor, exc)
        except TicketInvestigationRun.DoesNotExist:
            return {"phase": "halt"}
    finally:
        close_old_connections()
    return {"phase": "worker_handoff"}


def _after_planner(state: InvestigationState) -> str:
    return "reviewer" if state.get("phase") == "review" else "scheduler" if state.get("phase") == "schedule" else END


def _after_scheduler(state: InvestigationState) -> str:
    return "worker" if state.get("phase") == "worker" else END


def _finish_role(state, role):
    """Review/report only the exact saved evidence version; never acquire data."""
    close_old_connections()
    run = None
    try:
        planner = TicketInvestigationRun.objects.select_related("session__ticket").get(id=state["planner_id"])
        actor = get_user_model().objects.get(pk=state["actor_id"])
        session = planner.session
        if not _is_active(planner):
            return {"phase": "halt"}
        run = session.runs.get(role=role)
        if not _is_active(run):
            return {"phase": "halt"}
        fingerprint = evidence_fingerprint(session)
        if planner.result.get("fingerprint") != fingerprint:
            raise RuntimeError("Planner decision no longer matches the current investigation; resume Planner first.")
        if pending_results(session) or session.runs.filter(role="worker", status__in=["open", "running", "paused", "failed"]).exists():
            raise RuntimeError("Review/report requires all Workers to settle and all results to be consumed.")
        if role != "reviewer":
            review = session.runs.get(role="reviewer").result
            if review.get("verdict") != "ready" or review.get("fingerprint") != fingerprint:
                raise RuntimeError("Current evidence requires independent Reviewer approval before reporting.")
        run.status = "running"
        run.result = {}
        run.save(update_fields=["status", "result", "updated_at"])
        event(session=session, run=run, event_type=f"{role}_started", title=f"{run.title} started")
        if role == "explainer" and not findings(session):
            content = "No evidence-backed Findings were accepted. There is no Finding derivation to explain; Worker gaps remain in the report."
            trace = []
        else:
            extras = []
            reviewed_receipts = set()
            if role == "reviewer":
                def review(verdict, reason, goal_assessments, rework):
                    required_receipts = {identity for row in session.runs.filter(role="worker")
                                         for identity in row.result.get("receipt_ids", [])}
                    if not required_receipts <= reviewed_receipts:
                        raise ToolException("Read each Worker's cited original receipt using read_investigation_receipt before reviewing. Missing IDs: " + ", ".join(sorted(required_receipts - reviewed_receipts)))
                    expected = {str(goal.id) for goal in session.goals.all()}
                    if {item["goal_id"] for item in goal_assessments} != expected or len(goal_assessments) != len(expected):
                        raise ToolException("Assess every saved goal exactly once.")
                    if verdict == "needs_work" and not rework.strip():
                        raise ToolException("Needs-work requires a specific feasible follow-up, source and method.")
                    if verdict == "ready" and rework.strip():
                        raise ToolException("Ready cannot retain a request for rework; describe bounded gaps in the assessments.")
                    if any(item["assessment"] == "established" for item in goal_assessments) and not any(
                        row.result.get("outcome") == "answered" for row in session.runs.filter(role="worker")
                    ):
                        raise ToolException("No Worker established an evidence-backed answer; assess unproven goals as indeterminate/not_examined.")
                    if evidence_fingerprint(session) != fingerprint:
                        raise ToolException("Evidence changed during review; reread current records.")
                    run.result = {"verdict": verdict, "reason": reason, "goal_assessments": goal_assessments,
                                  "rework": rework, "fingerprint": fingerprint}
                    run.save(update_fields=["result", "updated_at"])
                    return {"saved": True, **run.result}
                extras = [tool("finish_investigation_review", "Independently assess every goal against saved Worker results and original receipt previews. ready means the report honestly reflects the evidence and gaps, not that the incident is proven. needs_work requires a feasible distinct follow-up; unavailable sources alone do not justify repeating the same work.", {
                    "verdict": {"type": "string", "enum": ["ready", "needs_work"]}, "reason": TEXT,
                    "goal_assessments": {"type": "array", "minItems": 1, "maxItems": 100, "items": {
                        "type": "object", "additionalProperties": False, "properties": {
                            "goal_id": {"type": "string"}, "assessment": {"type": "string", "enum": ["established", "indeterminate", "not_examined"]}, "reason": TEXT,
                        }, "required": ["goal_id", "assessment", "reason"]}},
                    "rework": {"type": "string", "maxLength": 4000},
                }, ["verdict", "reason", "goal_assessments", "rework"], review)]
            instruction = {
                "reviewer": "Review the persisted results independently. Use saved receipts where needed. Call finish_investigation_review before returning. Do not infer evidence from planning or successful bookkeeping. An indeterminate report is acceptable when it states precise evidence limits.",
                "explainer": "Explain each accepted Finding from its exact Worker result and receipt IDs. Separate observation, inference and limitations. Do not treat dialogue as new source evidence.",
                "reporter": "Produce the final investigation report from the reviewed saved state and Finding explanations. Include goals, bounded answers, evidence citations, unresolved gaps and recommended next actions. Explicitly mark indeterminate conclusions. Recommendations are not executed actions. Never change ticket status.",
            }[role]
            if role == "reporter":
                explanation = session.runs.get(role="explainer")
                if explanation.result.get("fingerprint") != fingerprint or explanation.status != "completed":
                    raise RuntimeError("Finding explanations must match the reviewed evidence before Reporter.")
                instruction += "\nSaved Finding explanation:\n" + explanation.result.get("content", "")
            response = run_investigation_turn(run=run, actor=actor, message=instruction,
                overrides=state["overrides"], model_guard=state.get("model_guard"), extra_tools=extras, records_only=True,
                read_receipt_ids=reviewed_receipts)
            if any(item.get("type") == "max_iterations" for item in response.get("trace", [])):
                raise RuntimeError("Review/report reached the model round limit; no completed report was published.")
            content, trace = str(response.get("response") or ""), response.get("trace") or []
        message = TicketInvestigationMessage.objects.create(session=session, run=run, created_by=actor,
                    role="assistant", content=content or "Role returned no narrative.", trace=trace)
        record_trace(session=session, run=run, message=message, trace=trace)
        run.refresh_from_db()
        if evidence_fingerprint(session) != fingerprint:
            raise RuntimeError("Investigation changed during review/report; stale output cannot be published.")
        if role == "reviewer" and not run.result.get("verdict"):
            raise RuntimeError("Reviewer returned dialogue without a saved completion decision.")
        if role != "reviewer":
            if not content.strip():
                raise RuntimeError("Role returned no report/explanation.")
            run.result = {"content": content, "fingerprint": fingerprint}
        run.status = "completed"
        run.save(update_fields=["result", "status", "updated_at"])
        event(session=session, run=run, event_type=f"{role}_completed", title=f"{run.title} completed", payload=run.result)
        if role == "reviewer" and run.result["verdict"] == "needs_work":
            return {"phase": "rework", "initial_message": "Independent Reviewer requests this specific follow-up. Inspect existing work before dispatch: " + run.result["rework"]}
        return {"phase": "reviewed" if role == "reviewer" else "explained" if role == "explainer" else "reported"}
    except Exception as exc:
        if run is not None:
            _record_failure(run, actor, exc)
        return {"phase": "halt"}
    finally:
        close_old_connections()


def _build_graph():
    graph = StateGraph(InvestigationState)
    graph.add_node("planner", _planner)
    graph.add_node("scheduler", _next_worker)
    graph.add_node("worker", _worker)
    graph.add_node("reviewer", lambda state: _finish_role(state, "reviewer"))
    graph.add_node("explainer", lambda state: _finish_role(state, "explainer"))
    graph.add_node("reporter", lambda state: _finish_role(state, "reporter"))
    graph.add_edge(START, "planner")
    graph.add_conditional_edges("planner", _after_planner, {"scheduler": "scheduler", "reviewer": "reviewer", END: END})
    graph.add_conditional_edges("scheduler", _after_scheduler, {"worker": "worker", END: END})
    graph.add_edge("worker", "planner")
    graph.add_conditional_edges("reviewer", lambda state: "planner" if state.get("phase") == "rework" else "explainer" if state.get("phase") == "reviewed" else END)
    graph.add_conditional_edges("explainer", lambda state: "reporter" if state.get("phase") == "explained" else END)
    graph.add_edge("reporter", END)
    return graph.compile()


_GRAPH = _build_graph()


def _run_graph(state: InvestigationState) -> None:
    planner_key = state["planner_id"]
    close_old_connections()
    try:
        # The graph is intentionally sequential: queued directions are claimed
        # one at a time, and each Worker result triggers another Planner pass.
        # LangGraph's recursion guard only protects against accidental cycles;
        # it is not a Worker-count policy.
        _GRAPH.invoke(state, {"recursion_limit": 1000})
    except Exception as exc:
        try:
            planner = TicketInvestigationRun.objects.get(id=planner_key)
            actor = get_user_model().objects.get(pk=state["actor_id"])
            _record_failure(planner, actor, exc)
        except TicketInvestigationRun.DoesNotExist:
            pass
    finally:
        with _IN_FLIGHT_LOCK:
            _IN_FLIGHT.discard(planner_key)
        close_old_connections()


def launch_ticket_investigation_graph(*, planner, actor, initial_message: str, overrides: dict, model_guard=None) -> bool:
    """Launch one durable Planner/Worker graph from a Main Agent handoff or Planner continuation."""
    key = str(planner.id)
    with _IN_FLIGHT_LOCK:
        if key in _IN_FLIGHT:
            return False
        _IN_FLIGHT.add(key)
    _EXECUTOR.submit(
        _run_graph,
        {
            "session_id": str(planner.session_id),
            "planner_id": key,
            "actor_id": actor.pk,
            "initial_message": initial_message,
            "overrides": overrides,
            "model_guard": model_guard,
            "phase": "initial",
        },
    )
    return True
