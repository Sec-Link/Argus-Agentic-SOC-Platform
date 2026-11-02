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
    TicketInvestigationMessage, TicketInvestigationRun, TicketInvestigationSession,
    TicketInvestigationSideConversation, TicketInvestigationSideMessage,
)
from .ticket_investigation_agent import run_investigation_turn
from .ticket_side_question_agent import build_snapshot, cancel as cancel_side_question, submit as submit_side_question
from .usage_recording import model_usage_context
from tickets.models import EventTicket


ROLE_TITLES = {
    "main": "Main Agent",
    "planner": "Planner · Situation Assessment",
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
    return {
        "id": str(session.id), "ticket_number": session.ticket_id, "sequence": session.sequence,
        "title": session.title, "model_profile_id": str(session.model_profile_id) if session.model_profile_id else None,
        "created_at": session.created_at.isoformat(), "updated_at": session.updated_at.isoformat(),
        "runs": [_serialize_run(run, messages) for run in runs],
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
    run.status = {"pause": "paused", "resume": "open", "cancel": "cancelled"}[action]
    run.save(update_fields=["status", "updated_at"])
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
    TicketInvestigationMessage.objects.create(session=session, run=run, created_by=actor, role="user", content=text)
    run.status = "running"
    run.save(update_fields=["status", "updated_at"])
    if session.model_profile_id != profile_id:
        session.model_profile_id = profile_id
        session.save(update_fields=["model_profile_id", "updated_at"])

    try:
        result = run_investigation_turn(run=run, actor=actor, message=text, overrides=overrides, model_guard=guard)
        TicketInvestigationMessage.objects.create(
            session=session, run=run, created_by=actor, role="assistant",
            content=str(result.get("response") or "No response was returned."), trace=result.get("trace") or [],
        )
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
