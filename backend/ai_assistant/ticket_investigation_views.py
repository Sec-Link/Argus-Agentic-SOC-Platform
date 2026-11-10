"""Ticket-scoped multi-role investigation sessions.

The endpoints store the role graph and delegate each turn to the existing
LangChain chat agent. They do not own credentials, model configuration, tool
execution, or approvals.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.permissions import DenyReadonlyUser
from .chat_errors import safe_chat_error
from .conversation_history import current_actor, require_history_permissions
from .model_selection import selected_model_config
from .models import (
    TicketInvestigationGoal, TicketInvestigationMessage, TicketInvestigationRun, TicketInvestigationSession,
    TicketInvestigationSideConversation, TicketInvestigationSideMessage,
)
from .ticket_investigation_agent import run_investigation_turn
from .ticket_investigation_graph import launch_ticket_investigation_graph
from .ticket_investigation_runtime import event, record_trace
from .ticket_side_question_agent import build_snapshot, cancel as cancel_side_question, submit as submit_side_question
from .usage_recording import model_usage_context
from tickets.models import EventTicket


ROLE_TITLES = {
    "main": "Main Agent",
    "planner": "Planner · Situation Assessment",
    "reviewer": "Investigation Reviewer · Ready for Report",
    "reporter": "Reporter · Evidence Review",
    "explainer": "Finding Explainer · Report Derivations",
}


class SessionCreateSerializer(serializers.Serializer):
    model_profile_id = serializers.UUIDField(required=False)
    title = serializers.CharField(required=False, max_length=120, allow_blank=True)


class MessageSerializer(serializers.Serializer):
    run_id = serializers.UUIDField()
    message = serializers.CharField(max_length=4000, trim_whitespace=True)
    model_profile_id = serializers.UUIDField(required=False)


class WorkerCreateSerializer(serializers.Serializer):
    objective = serializers.CharField(max_length=4000, trim_whitespace=True)
    title = serializers.CharField(required=False, max_length=180, allow_blank=True)
    parent_id = serializers.UUIDField(required=False)


class ControlSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=("pause", "resume", "cancel"))


class SideQuestionSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=4000, trim_whitespace=True)
    model_profile_id = serializers.UUIDField(required=False)


class WorkerFeedbackSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=4000, trim_whitespace=True)


def _ticket(ticket_number):
    ticket = EventTicket.objects.filter(ticket_number=ticket_number, is_deleted=False).first()
    if ticket is None:
        raise NotFound("Ticket not found.")
    return ticket


def _actor(request, *, write=False):
    actor = current_actor(request.user, write=write)
    require_history_permissions(actor, ("tickets.view_eventticket",))
    return actor


def _session(ticket, session_id, actor):
    session = TicketInvestigationSession.objects.filter(id=session_id, ticket=ticket, owner=actor).first()
    if session is None:
        raise NotFound("Investigation session not found.")
    return session


def _serialize_message(message):
    return {
        "id": str(message.id), "run_id": str(message.run_id), "role": message.role,
        "content": message.content, "trace": message.trace if isinstance(message.trace, list) else [],
        "created_at": message.created_at.isoformat(),
    }


def _serialize_run(run, messages):
    return {
        "id": str(run.id), "parent_id": str(run.parent_id) if run.parent_id else None,
        "role": run.role, "title": run.title, "objective": run.objective, "status": run.status,
        "created_at": run.created_at.isoformat(), "updated_at": run.updated_at.isoformat(),
        "messages": [_serialize_message(message) for message in messages if message.run_id == run.id],
    }


def _serialize_session(session):
    runs = list(session.runs.order_by("created_at", "id"))
    messages = list(session.messages.select_related("run").order_by("created_at", "id")[:500])
    goals = list(session.goals.order_by("created_at", "id")[:100])
    events = list(session.runtime_events.select_related("run", "message").order_by("created_at", "id")[:500])
    receipts = list(session.tool_receipts.select_related("run", "message").order_by("created_at", "id")[:500])
    return {
        "id": str(session.id), "ticket_number": session.ticket_id, "sequence": session.sequence,
        "title": session.title, "model_profile_id": str(session.model_profile_id) if session.model_profile_id else None,
        "created_at": session.created_at.isoformat(), "updated_at": session.updated_at.isoformat(),
        "runs": [_serialize_run(run, messages) for run in runs],
        "goals": [{"id": str(row.id), "title": row.title, "acceptance_criteria": row.acceptance_criteria,
                   "status": row.status, "evidence_summary": row.evidence_summary, "created_at": row.created_at.isoformat(),
                   "updated_at": row.updated_at.isoformat()} for row in goals],
        "runtime_events": [{"id": str(row.id), "run_id": str(row.run_id) if row.run_id else None,
                            "message_id": str(row.message_id) if row.message_id else None, "event_type": row.event_type,
                            "title": row.title, "content": row.content, "payload": row.payload if isinstance(row.payload, dict) else {},
                            "created_at": row.created_at.isoformat()} for row in events],
        "tool_receipts": [{"id": str(row.id), "run_id": str(row.run_id), "message_id": str(row.message_id) if row.message_id else None,
                           "call_id": row.call_id, "execution_id": row.execution_id, "tool_name": row.tool_name, "status": row.status,
                           "arguments": row.arguments if isinstance(row.arguments, dict) else {}, "result_preview": row.result_preview,
                           "created_at": row.created_at.isoformat()} for row in receipts],
    }


def _summary(session):
    return {
        "id": str(session.id), "ticket_number": session.ticket_id, "sequence": session.sequence,
        "title": session.title, "model_profile_id": str(session.model_profile_id) if session.model_profile_id else None,
        "created_at": session.created_at.isoformat(), "updated_at": session.updated_at.isoformat(),
    }


def _serialize_side_message(message):
    return {
        "id": str(message.id), "role": message.role, "status": message.status,
        "content": message.content, "created_at": message.created_at.isoformat(),
        "updated_at": message.updated_at.isoformat(),
    }


def _serialize_side_conversation(conversation, parent_run):
    if conversation is None:
        return {
            "id": None, "parent_run_id": str(parent_run.id), "model_profile_id": None,
            "snapshot_available": True, "messages": [],
        }
    return {
        "id": str(conversation.id), "parent_run_id": str(conversation.parent_run_id),
        "model_profile_id": str(conversation.model_profile_id) if conversation.model_profile_id else None,
        "snapshot_available": True,
        "messages": [_serialize_side_message(row) for row in conversation.messages.order_by("created_at", "id")[:100]],
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_sessions(request, ticket_number):
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=request.method == "POST")
    if request.method == "GET":
        rows = TicketInvestigationSession.objects.filter(ticket=ticket, owner=actor).order_by("-updated_at", "-id")[:100]
        response = Response({"results": [_summary(row) for row in rows]})
        response["Cache-Control"] = "private, no-store"
        return response

    serializer = SessionCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        next_sequence = (TicketInvestigationSession.objects.select_for_update().filter(ticket=ticket, owner=actor)
                         .aggregate(value=Max("sequence"))["value"] or 0) + 1
        session = TicketInvestigationSession.objects.create(
            ticket=ticket, owner=actor, sequence=next_sequence,
            title=serializer.validated_data.get("title") or f"Investigation #{next_sequence}",
            model_profile_id=serializer.validated_data.get("model_profile_id"),
        )
        for role, title in ROLE_TITLES.items():
            TicketInvestigationRun.objects.create(session=session, created_by=actor, role=role, title=title)
        event(session=session, event_type="session_created", title="Investigation session created", payload={"sequence": next_sequence})
    return Response(_serialize_session(session), status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def investigation_session_detail(request, ticket_number, session_id):
    ticket = _ticket(ticket_number)
    actor = _actor(request)
    response = Response(_serialize_session(_session(ticket, session_id, actor)))
    response["Cache-Control"] = "private, no-store"
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_worker_create(request, ticket_number, session_id):
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=True)
    session = _session(ticket, session_id, actor)
    serializer = WorkerCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    parent = None
    if serializer.validated_data.get("parent_id"):
        parent = session.runs.filter(id=serializer.validated_data["parent_id"], role__in=("main", "planner")).first()
        if parent is None:
            raise serializers.ValidationError({"parent_id": "Choose a Main Agent or Planner run in this session."})
    objective = serializer.validated_data["objective"]
    run = TicketInvestigationRun.objects.create(
        session=session, parent=parent, created_by=actor, role="worker",
        title=serializer.validated_data.get("title") or f"Worker · {objective[:80]}", objective=objective,
    )
    event(session=session, run=run, event_type="intent_created", title=f"Worker task created: {run.title}", content=objective)
    return Response(_serialize_session(session), status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_run_control(request, ticket_number, session_id, run_id):
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=True)
    session = _session(ticket, session_id, actor)
    run = session.runs.filter(id=run_id).first()
    if run is None:
        raise NotFound("Investigation role not found.")
    serializer = ControlSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    action = serializer.validated_data["action"]
    overrides = guard = None
    if action == "resume" and run.role in {"planner", "worker"}:
        if not session.model_profile_id:
            raise serializers.ValidationError({"model_profile_id": "Choose an enabled model before resuming investigation work."})
        overrides, guard = selected_model_config(
            actor, {"model_profile_id": session.model_profile_id}, permissions=("tickets.view_eventticket",),
        )
        overrides["_usage_context"] = model_usage_context(
            actor, source="ticket_investigation", overrides=overrides, agent_name="planner",
        )
    run.status = {"pause": "paused", "resume": "open", "cancel": "cancelled"}[action]
    run.save(update_fields=["status", "updated_at"])
    event(session=session, run=run, event_type=f"run_{action}", title=f"{run.title}: {action}")
    if action == "resume" and run.role in {"planner", "worker"}:
        planner = run if run.role == "planner" else run.parent
        if planner is not None:
            if planner.status == "paused":
                planner.status = "open"
                planner.save(update_fields=["status", "updated_at"])
            launch_ticket_investigation_graph(
                planner=planner,
                actor=actor,
                initial_message=(
                    "Resume this investigation from its durable state. Review queued and completed Worker "
                    "directions, then continue the next necessary planning step."
                ),
                overrides=overrides,
                model_guard=guard,
            )
    return Response(_serialize_session(session))


@api_view(["POST"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_message(request, ticket_number, session_id):
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=True)
    session = _session(ticket, session_id, actor)
    serializer = MessageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    run = session.runs.filter(id=serializer.validated_data["run_id"]).first()
    if run is None:
        raise serializers.ValidationError({"run_id": "Choose a role in this investigation session."})
    if run.role == "side_question":
        raise serializers.ValidationError({"run_id": "Side Question is an independent panel; select Main Agent, Planner, or a Worker."})
    if run.status in {"paused", "cancelled"}:
        raise serializers.ValidationError({"run_id": "Resume this role before sending a message."})
    if run.status == "running":
        return Response({"error": "This role is already running. Wait for its current turn to finish."}, status=status.HTTP_409_CONFLICT)

    profile_id = serializer.validated_data.get("model_profile_id") or session.model_profile_id
    if not profile_id:
        raise serializers.ValidationError({"model_profile_id": "Choose an enabled model before sending."})
    data = {"model_profile_id": profile_id}
    overrides, guard = selected_model_config(actor, data, permissions=("tickets.view_eventticket",))
    overrides["_usage_context"] = model_usage_context(
        actor, source="ticket_investigation", overrides=overrides, agent_name=run.role,
    )
    text = serializer.validated_data["message"]
    if run.role == "planner" and not session.messages.filter(run__role="main", role="user").exists():
        raise serializers.ValidationError({"run_id": "Begin this investigation from Main Agent. Main Agent defines the goal and hands work to Planner."})
    TicketInvestigationMessage.objects.create(session=session, run=run, created_by=actor, role="user", content=text)
    event(session=session, run=run, event_type="user_message", title=f"Message to {run.title}", content=text)
    run.status = "running"
    run.save(update_fields=["status", "updated_at"])
    if session.model_profile_id != profile_id:
        session.model_profile_id = profile_id
        session.save(update_fields=["model_profile_id", "updated_at"])

    if run.role == "main":
        try:
            result = run_investigation_turn(run=run, actor=actor, message=text, overrides=overrides, model_guard=guard)
            main_summary = str(result.get("response") or "No response was returned.")
            assistant_message = TicketInvestigationMessage.objects.create(
                session=session, run=run, created_by=actor, role="assistant",
                content=main_summary, trace=result.get("trace") or [],
            )
            record_trace(session=session, run=run, message=assistant_message, trace=result.get("trace"))
            run.status = "completed"
            run.save(update_fields=["status", "updated_at"])
            event(session=session, run=run, message=assistant_message, event_type="main_assessment_completed", title="Main Agent assessment completed")
        except Exception as exc:
            diagnostic = safe_chat_error(exc)
            TicketInvestigationMessage.objects.create(session=session, run=run, created_by=actor, role="system", content=diagnostic["message"])
            run.status = "failed"
            run.save(update_fields=["status", "updated_at"])
            session.save(update_fields=["updated_at"])
            return Response({"error": diagnostic["message"], "code": diagnostic["code"], "session": _serialize_session(session)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        planner = session.runs.filter(role="planner").first()
        if planner is None or planner.status in {"paused", "cancelled"}:
            event(session=session, run=run, event_type="planner_handoff_blocked", title="Main Agent could not hand off to Planner")
            session.save(update_fields=["updated_at"])
            return Response({"error": "Planner is unavailable for this session.", "session": _serialize_session(session)}, status=status.HTTP_409_CONFLICT)
        if not session.goals.exists():
            goal = TicketInvestigationGoal.objects.create(
                session=session, created_by=actor, title=text[:500],
                acceptance_criteria="Produce an evidence-backed assessment, unresolved gaps, and recommended next actions for this ticket.",
            )
            event(session=session, run=run, event_type="goal_defined", title=f"Goal defined: {goal.title}", content=goal.acceptance_criteria,
                  payload={"goal_id": str(goal.id), "source": "main_agent"})
        handoff = (
            "Main Agent has accepted the investigation request below. Build the investigation plan, refine the "
            "saved goal and acceptance criteria if needed, and create durable Worker tasks for evidence collection.\n\n"
            f"Investigator request:\n{text}\n\n"
            f"Main Agent assessment:\n{main_summary[:6000]}"
        )
        TicketInvestigationMessage.objects.create(
            session=session, run=planner, created_by=actor, role="system",
            content="Main Agent handed this investigation to Planner.",
        )
        event(session=session, run=planner, event_type="main_to_planner_handoff", title="Main Agent delegated to Planner", content="Planner will create the investigation plan and Worker directions.")
        planner_overrides = dict(overrides)
        planner_overrides["_usage_context"] = model_usage_context(
            actor, source="ticket_investigation", overrides=planner_overrides, agent_name="planner",
        )
        if not launch_ticket_investigation_graph(
            planner=planner,
            actor=actor,
            initial_message=handoff,
            overrides=planner_overrides,
            model_guard=guard,
        ):
            event(session=session, run=planner, event_type="planner_handoff_queued", title="Planner already processing this session")
        session.save(update_fields=["updated_at"])
        return Response(_serialize_session(session), status=status.HTTP_202_ACCEPTED)

    if run.role == "planner":
        if not session.goals.exists():
            goal = TicketInvestigationGoal.objects.create(
                session=session, created_by=actor, title=text[:500],
                acceptance_criteria="Produce an evidence-backed assessment, unresolved gaps, and recommended next actions for this ticket.",
            )
            event(session=session, run=run, event_type="goal_defined", title=f"Goal defined: {goal.title}", content=goal.acceptance_criteria,
                  payload={"goal_id": str(goal.id)})
        if not launch_ticket_investigation_graph(
            planner=run,
            actor=actor,
            initial_message=text,
            overrides=overrides,
            model_guard=guard,
        ):
            return Response(
                {"error": "This Planner is already running. Wait for its current investigation pass to finish."},
                status=status.HTTP_409_CONFLICT,
            )
        session.save(update_fields=["updated_at"])
        return Response(_serialize_session(session), status=status.HTTP_202_ACCEPTED)

    try:
        result = run_investigation_turn(run=run, actor=actor, message=text, overrides=overrides, model_guard=guard)
        assistant_message = TicketInvestigationMessage.objects.create(
            session=session, run=run, created_by=actor, role="assistant",
            content=str(result.get("response") or "No response was returned."), trace=result.get("trace") or [],
        )
        record_trace(session=session, run=run, message=assistant_message, trace=result.get("trace"))
        run.status = "completed"
        run.save(update_fields=["status", "updated_at"])
    except Exception as exc:
        diagnostic = safe_chat_error(exc)
        TicketInvestigationMessage.objects.create(session=session, run=run, created_by=actor, role="system", content=diagnostic["message"])
        run.status = "failed"
        run.save(update_fields=["status", "updated_at"])
        session.save(update_fields=["updated_at"])
        return Response({"error": diagnostic["message"], "code": diagnostic["code"], "session": _serialize_session(session)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    session.save(update_fields=["updated_at"])
    return Response(_serialize_session(session))


@api_view(["POST"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_worker_feedback(request, ticket_number, session_id, run_id):
    """Persist feedback on a Worker Intent and route the durable work back through Planner."""
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=True)
    session = _session(ticket, session_id, actor)
    worker = session.runs.select_related("parent").filter(id=run_id, role="worker").first()
    if worker is None or worker.parent is None or worker.parent.role != "planner":
        raise NotFound("Worker intent not found.")
    serializer = WorkerFeedbackSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if not session.model_profile_id:
        raise serializers.ValidationError({"model_profile_id": "Choose an enabled model before sending Worker feedback."})
    overrides, guard = selected_model_config(
        actor, {"model_profile_id": session.model_profile_id}, permissions=("tickets.view_eventticket",),
    )
    overrides["_usage_context"] = model_usage_context(
        actor, source="ticket_investigation", overrides=overrides, agent_name="worker",
    )
    text = serializer.validated_data["message"]
    TicketInvestigationMessage.objects.create(session=session, run=worker, created_by=actor, role="user", content=text)
    event(session=session, run=worker, event_type="worker_feedback", title=f"Feedback for {worker.title}", content=text)
    if worker.status not in {"running", "cancelled"}:
        worker.status = "open"
        worker.save(update_fields=["status", "updated_at"])
    launch_ticket_investigation_graph(
        planner=worker.parent,
        actor=actor,
        initial_message=(
            f"A user supplied feedback for Worker '{worker.title}'. Review the feedback and the saved Worker "
            "history, then continue the current investigation plan."
        ),
        overrides=overrides,
        model_guard=guard,
    )
    return Response(_serialize_session(session), status=status.HTTP_202_ACCEPTED)


def _side_parent(session, run_id):
    run = session.runs.filter(id=run_id, role__in=("main", "planner", "worker")).first()
    if run is None:
        raise NotFound("Select a Main Agent, Planner, or Worker before opening Side Question.")
    return run


@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_side_questions(request, ticket_number, session_id, run_id):
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=request.method != "GET")
    session = _session(ticket, session_id, actor)
    parent_run = _side_parent(session, run_id)
    conversation = TicketInvestigationSideConversation.objects.filter(session=session, parent_run=parent_run, owner=actor).first()
    if request.method == "GET":
        response = Response(_serialize_side_conversation(conversation, parent_run))
        response["Cache-Control"] = "private, no-store"
        return response
    if request.method == "DELETE":
        if conversation:
            for row in conversation.messages.filter(status__in=("queued", "running")):
                cancel_side_question(row.id)
            conversation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = SideQuestionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    profile_id = serializer.validated_data.get("model_profile_id") or (conversation.model_profile_id if conversation else None) or session.model_profile_id
    if not profile_id:
        raise serializers.ValidationError({"model_profile_id": "Choose an enabled model before asking a Side Question."})
    overrides, guard = selected_model_config(actor, {"model_profile_id": profile_id}, permissions=("tickets.view_eventticket",))
    overrides["_usage_context"] = model_usage_context(actor, source="ticket_side_question", overrides=overrides, agent_name="side_question")
    with transaction.atomic():
        conversation, _ = TicketInvestigationSideConversation.objects.select_for_update().get_or_create(
            session=session, parent_run=parent_run, owner=actor, defaults={"model_profile_id": profile_id},
        )
        if conversation.messages.filter(status__in=("queued", "running")).exists():
            return Response({"error": "Wait for the current Side Question answer to finish."}, status=status.HTTP_409_CONFLICT)
        if conversation.model_profile_id != profile_id:
            conversation.model_profile_id = profile_id
            conversation.save(update_fields=["model_profile_id", "updated_at"])
        side_message = TicketInvestigationSideMessage.objects.create(
            conversation=conversation, created_by=actor, role="user", status="queued",
            content=serializer.validated_data["question"], context_snapshot=build_snapshot(parent_run),
        )
    submit_side_question(side_message, actor=actor, overrides=overrides, model_guard=guard)
    return Response(_serialize_side_conversation(conversation, parent_run), status=status.HTTP_202_ACCEPTED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, DenyReadonlyUser])
def investigation_side_question_cancel(request, ticket_number, session_id, run_id, message_id):
    ticket = _ticket(ticket_number)
    actor = _actor(request, write=True)
    session = _session(ticket, session_id, actor)
    parent_run = _side_parent(session, run_id)
    message = TicketInvestigationSideMessage.objects.filter(
        id=message_id, conversation__session=session, conversation__parent_run=parent_run, conversation__owner=actor,
        role="user", status__in=("queued", "running"),
    ).first()
    if message is None:
        raise NotFound("Running Side Question not found.")
    cancel_side_question(message.id)
    message.status = "cancelled"
    message.save(update_fields=["status", "updated_at"])
    conversation = message.conversation
    return Response(_serialize_side_conversation(conversation, parent_run))
