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

from django.contrib.auth import get_user_model
from django.db import close_old_connections, transaction
from langchain_core.tools import StructuredTool, ToolException
from langgraph.graph import END, START, StateGraph

from .chat_errors import safe_chat_error
from .models import TicketInvestigationGoal, TicketInvestigationMessage, TicketInvestigationRun, TicketInvestigationSession
from .ticket_investigation_agent import run_investigation_turn
from .ticket_investigation_runtime import event, record_trace


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

    def create_worker_task(title: str, objective: str) -> dict[str, str]:
        clean_title = str(title or "").strip()
        clean_objective = str(objective or "").strip()
        if not 1 <= len(clean_title) <= 180:
            raise ToolException("Worker title must contain 1-180 characters.")
        if not 1 <= len(clean_objective) <= 4000:
            raise ToolException("Worker objective must contain 1-4000 characters.")

        with transaction.atomic():
            current = TicketInvestigationRun.objects.select_related("session").select_for_update().get(id=planner.id)
            if current.status in {"paused", "cancelled"}:
                raise ToolException("The Planner is paused or cancelled; it cannot create new Worker tasks.")
            worker = TicketInvestigationRun.objects.create(
                session=current.session,
                parent=current,
                created_by=actor,
                role="worker",
                title=clean_title,
                objective=clean_objective,
            )
            event(session=current.session, run=current, event_type="intent_created", title=f"Worker task created: {clean_title}",
                  content=clean_objective, payload={"worker_id": str(worker.id)})
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
            },
            "required": ["title", "objective"],
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
    return [goal_tool, worker_tool]


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
                f"{worker_title} has completed its assigned investigation direction. "
                "Review its saved findings, update the plan, and create any further Worker tasks needed "
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
        planner.save(update_fields=["status", "updated_at"])
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
        planner.status = "completed"
        planner.save(update_fields=["status", "updated_at"])
        return {"phase": "schedule"}
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
            worker.status = "completed"
            worker.save(update_fields=["status", "updated_at"])
            event(session=worker.session, run=worker, message=assistant_message, event_type="intent_completed", title=f"Worker completed: {worker.title}")
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
    return END if state.get("phase") == "halt" else "scheduler"


def _after_scheduler(state: InvestigationState) -> str:
    return "worker" if state.get("phase") == "worker" else END


def _build_graph():
    graph = StateGraph(InvestigationState)
    graph.add_node("planner", _planner)
    graph.add_node("scheduler", _next_worker)
    graph.add_node("worker", _worker)
    graph.add_edge(START, "planner")
    graph.add_conditional_edges("planner", _after_planner, {"scheduler": "scheduler", END: END})
    graph.add_conditional_edges("scheduler", _after_scheduler, {"worker": "worker", END: END})
    graph.add_edge("worker", "planner")
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
