"""Time-bounded AI activity reports. Only explicit reviewers see other users."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Avg, Case, CharField, Count, Max, Q, Sum, Value, When
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Cast
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import MCPToolExecution, ModelUsage
from .call_details import snapshot, stored_detail, unavailable
from .conversation_history import current_actor, event_permissions, require_history_permissions


GROUP_LIMIT = 200
TOOL_FAILED = ("failed", "rejected", "cancelled")


class MonitorQuery(serializers.Serializer):
    period_value = serializers.IntegerField(min_value=1, max_value=8760, default=24)
    period_unit = serializers.ChoiceField(choices=("hour", "day", "week"), default="hour")
    user_id = serializers.IntegerField(min_value=1, required=False)
    model_profile_id = serializers.UUIDField(required=False)
    tool = serializers.CharField(max_length=200, required=False, allow_blank=True)
    status = serializers.CharField(max_length=32, required=False, allow_blank=True)
    page = serializers.IntegerField(min_value=1, max_value=1000000, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)

    def validate(self, attrs):
        hours = attrs["period_value"] * {"hour": 1, "day": 24, "week": 168}[attrs["period_unit"]]
        if hours > 8760:
            raise serializers.ValidationError({"period_value": "Choose a window of at most 365 days."})
        attrs["hours"] = hours
        return attrs


def _scope(request):
    actor = get_user_model().objects.filter(pk=request.user.pk, is_active=True).first()
    if actor is None:
        raise PermissionDenied("An active account is required to view AI activity.")
    query = MonitorQuery(data=request.query_params)
    query.is_valid(raise_exception=True)
    params = query.validated_data
    can_view_all = actor.has_perm("ai_assistant.review_all_modelusage")
    if params.get("user_id", actor.pk) != actor.pk and not can_view_all:
        raise PermissionDenied("You can only view your own AI activity.")
    until = timezone.now()
    since = until - timedelta(hours=params["hours"])
    return actor, can_view_all, params, since, until


def _actor_key(queryset, *, tools=False):
    # Historical page-chat rows already carry a server-written owner in their audit.
    # Keep it textual: malformed old metadata must never cause a SQL integer cast failure.
    cases = [When(actor_id__isnull=False, then=Cast("actor_id", CharField()))]
    if tools:
        cases.append(When(source="page_chat", response_payload___page_chat__user_id__regex=r"^[0-9]{1,18}$", then=Cast(
            KeyTextTransform("user_id", KeyTransform("_page_chat", "response_payload")), CharField(),
        )))
    return queryset.annotate(report_actor_key=Case(*cases, default=Value(""), output_field=CharField()))


def _user_id(value):
    value = str(value or "")
    return int(value) if value.isascii() and value.isdigit() and 0 < len(value) <= 18 else None


def _user_labels(keys):
    ids = {_user_id(key) for key in keys} - {None}
    return dict(get_user_model().objects.filter(pk__in=ids).values_list("pk", "username"))


def _user_fields(key, labels, snapshot=""):
    user_id = _user_id(key)
    return {"user_id": user_id, "user_label": labels.get(user_id) or snapshot or "Unknown / deleted user"}


def _options(base):
    keys = list(base.order_by("report_actor_key").values_list("report_actor_key", flat=True).distinct()[:GROUP_LIMIT + 1])
    labels = _user_labels(keys[:GROUP_LIMIT])
    users = [{"id": pk, "label": labels.get(pk, f"User {pk}")} for key in keys[:GROUP_LIMIT] if (pk := _user_id(key))]
    model_rows = list(base.exclude(model_profile_id=None).order_by("model_profile_id").values(
        "model_profile_id",
    ).annotate(model_name=Max("model_name"))[:GROUP_LIMIT + 1])
    models = [{"id": str(row["model_profile_id"]), "label": row["model_name"]} for row in model_rows[:GROUP_LIMIT]]
    return users, models, len(keys) > GROUP_LIMIT or len(model_rows) > GROUP_LIMIT


def _page(queryset, params):
    count = queryset.count()
    offset = (params["page"] - 1) * params["page_size"]
    rows = list(queryset.order_by("-start_time", "-pk")[offset:offset + params["page_size"]]) if offset < count else []
    return rows, {"count": count, "page": params["page"], "page_size": params["page_size"],
                  "total_pages": max(1, (count + params["page_size"] - 1) // params["page_size"])}


def _tool_aggregates():
    return dict(
        total_calls=Count("pk"), success_calls=Count("pk", filter=Q(status="completed")),
        failed_calls=Count("pk", filter=Q(status__in=TOOL_FAILED)),
        pending_calls=Count("pk", filter=~Q(status__in=("completed", *TOOL_FAILED))),
        avg_duration_ms=Avg("duration_ms"), last_call_time=Max("start_time"),
    )


def _model_aggregates():
    return dict(
        total_calls=Count("pk"), success_calls=Count("pk", filter=Q(status="success")),
        failed_calls=Count("pk", filter=Q(status="failed")), running_calls=Count("pk", filter=Q(status="running")),
        usage_known_calls=Count("pk", filter=Q(input_tokens__isnull=False, output_tokens__isnull=False)),
        input_tokens=Sum("input_tokens"), output_tokens=Sum("output_tokens"),
        cached_input_tokens=Sum("cached_input_tokens"), total_tokens=Sum("total_tokens"),
        cost_known_calls=Count("pk", filter=Q(estimated_cost__isnull=False)), avg_duration_ms=Avg("duration_ms"),
    )


def _model_stats(queryset, fields=()):
    rows = list(queryset.order_by().values(*fields).annotate(**_model_aggregates()).order_by(*fields)[:GROUP_LIMIT + 1]) if fields else [queryset.aggregate(**_model_aggregates())]
    truncated = len(rows) > GROUP_LIMIT
    rows = rows[:GROUP_LIMIT]
    groups = {tuple(row[field] for field in fields): row for row in rows}
    for row in rows:
        row["costs"] = []
    cost_query = queryset.filter(estimated_cost__isnull=False)
    if fields:
        # Restrict the currency query to the same bounded displayed groups.
        selected = Q(pk__in=[])
        for row in rows:
            selected |= Q(**{field: row[field] for field in fields})
        cost_query = cost_query.filter(selected)
    for cost in cost_query.order_by().values(*fields, "currency").annotate(estimated_cost=Sum("estimated_cost"), known_calls=Count("pk")):
        key = tuple(cost[field] for field in fields)
        groups[key]["costs"].append({"currency": cost["currency"], "estimated_cost": format(cost["estimated_cost"], ".12f"), "known_calls": cost["known_calls"]})
    return rows, truncated


def _base(request, *, tools):
    actor, can_view_all, params, since, until = _scope(request)
    queryset = (MCPToolExecution if tools else ModelUsage).objects.filter(
        start_time__gte=since, start_time__lte=until,
    )
    selected_user = params.get("user_id") if can_view_all else actor.pk
    if selected_user is not None:
        owned = Q(actor_id=selected_user)
        if tools:
            owned |= Q(actor_id__isnull=True, source="page_chat", response_payload___page_chat__user_id=selected_user)
        # Filter the stored FK before grouping instead of filtering an SQL cast.
        scoped = queryset.filter(owned)
    else:
        scoped = queryset
    options_query = _actor_key(queryset if can_view_all else scoped, tools=tools)
    users, models, truncated = _options(options_query)
    queryset = _actor_key(scoped, tools=tools)
    if "model_profile_id" in params:
        queryset = queryset.filter(model_profile_id=params["model_profile_id"])
    status = params.get("status")
    allowed = {"completed", "failed", "running", "awaiting_approval", "approved", "rejected", "cancelled"} if tools else {"running", "success", "failed"}
    if status and status != "all":
        if status not in allowed:
            raise serializers.ValidationError({"status": "Unknown execution status."})
        queryset = queryset.filter(status=status)
    if tools and params.get("tool"):
        queryset = queryset.filter(tool_name__icontains=params["tool"])
    payload = {"scope": {"can_view_all": can_view_all}, "window": {"since": since.isoformat(), "until": until.isoformat()},
               "users": users, "models": models, "groups_truncated": truncated}
    return queryset, params, payload


def _execution_metadata(row, labels):
    return {
        "id": str(row.pk), **_user_fields(row.report_actor_key, labels, row.actor_label),
        "request_id": str(row.request_id) if row.request_id else None,
        "model_profile_id": str(row.model_profile_id) if row.model_profile_id else None,
        "model_name": row.model_name, "agent_name": row.agent_name, "source": row.source,
        "status": row.status, "start_time": row.start_time, "end_time": row.end_time, "duration_ms": row.duration_ms,
    }


def _response(payload):
    response = Response(payload)
    response["Cache-Control"] = "private, no-store"
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def tool_monitor(request):
    queryset, params, payload = _base(request, tools=True)
    queryset = queryset.defer("arguments", "response_payload", "error", "endpoint", "request_detail", "response_detail", "detail_permissions")
    payload["summary"] = queryset.aggregate(**_tool_aggregates())
    by_tool = list(queryset.order_by().values("tool_name").annotate(**_tool_aggregates()).order_by("tool_name")[:GROUP_LIMIT + 1])
    by_user = list(queryset.order_by().values("report_actor_key").annotate(
        **_tool_aggregates(), actor_label=Max("actor_label"),
    ).order_by("report_actor_key")[:GROUP_LIMIT + 1])
    rows, page = _page(queryset, params)
    labels = _user_labels([row.report_actor_key for row in rows] + [row["report_actor_key"] for row in by_user])
    payload.update(page, by_tool=by_tool[:GROUP_LIMIT], by_user=[{
        **{key: value for key, value in row.items() if key not in {"report_actor_key", "actor_label"}},
        **_user_fields(row["report_actor_key"], labels, row["actor_label"]),
    } for row in by_user[:GROUP_LIMIT]])
    payload["executions"] = [{**_execution_metadata(row, labels), "tool_name": row.tool_name,
                              "tool_source": row.tool_source or (row.source if row.source != "page_chat" else "unknown")}
                             for row in rows]
    payload["groups_truncated"] |= len(by_tool) > GROUP_LIMIT or len(by_user) > GROUP_LIMIT
    return _response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def model_monitor(request):
    queryset, params, payload = _base(request, tools=False)
    queryset = queryset.defer("request_detail", "response_detail", "detail_permissions")
    summary, _ = _model_stats(queryset)
    by_model, models_truncated = _model_stats(queryset, ("model_profile_id", "profile_name", "model_name"))
    by_user, users_truncated = _model_stats(queryset, ("report_actor_key",))
    rows, page = _page(queryset, params)
    labels = _user_labels([row.report_actor_key for row in rows] + [row["report_actor_key"] for row in by_user])
    for row in by_user:
        row.update(_user_fields(row.pop("report_actor_key"), labels))
    payload.update(page, summary=summary[0], by_model=by_model, by_user=by_user,
                   executions=[{**_execution_metadata(row, labels), "profile_name": row.profile_name,
                                **{name: getattr(row, name) for name in ("input_tokens", "output_tokens", "cached_input_tokens", "total_tokens", "currency", "error_code")},
                                "estimated_cost": str(row.estimated_cost) if row.estimated_cost is not None else None}
                               for row in rows])
    payload["groups_truncated"] |= models_truncated or users_truncated
    return _response(payload)


def _detail_row(request, pk, *, tools):
    actor = current_actor(request.user)
    rows = (MCPToolExecution if tools else ModelUsage).objects.select_related("conversation")
    if not actor.has_perm("ai_assistant.review_all_modelusage"):
        owned = Q(actor_id=actor.pk)
        if tools:
            owned |= Q(actor_id__isnull=True, source="page_chat", response_payload___page_chat__user_id=actor.pk)
        rows = rows.filter(owned)
    row = _actor_key(rows, tools=tools).filter(pk=pk).first()
    if row is None:
        raise NotFound("Call not found.")
    owner_id = _user_id(row.report_actor_key)
    if owner_id != actor.pk:
        if not actor.has_perm("ai_assistant.review_all_pagechatconversation"):
            raise PermissionDenied("Reviewing another user's call content requires conversation history review permission.")
    else:
        required = set(row.conversation.required_permissions) if row.conversation_id else set()
        required.update(row.detail_permissions or [])
        if tools:
            required.update(event_permissions({
                "tool": row.tool_name, "arguments": row.arguments, "source": row.tool_source or None,
            }))
        if row.source in {"ticket_chat", "ticket_analysis", "ticket_mention"}:
            required.add("tickets.view_eventticket")
        require_history_permissions(actor, required)
    return actor, row, owner_id


def _audit_detail(request, actor, row, owner_id, *, tools):
    from accounts.audit import AuditService, request_ip, request_user_agent
    from accounts.models import AuditLog
    AuditService.log_event(
        event_type=AuditLog.EventType.ACTIVITY, status=AuditLog.Status.SUCCESS,
        action_type=AuditLog.ActionType.FEATURE_EXEC, user_email=actor.email,
        ip_address=request_ip(request), user_agent=request_user_agent(request),
        path=request.path, method=request.method,
        metadata={"resource": "ai_tool_call" if tools else "ai_model_call", "action": "view_detail",
                  "id": str(row.pk), "actor_id": actor.pk, "owner_id": owner_id},
    )


def _tool_request(row):
    if row.request_detail is not None:
        return stored_detail(row.request_detail)
    # These are that exact execution's stored arguments, never a reconstruction
    # from a conversation sharing its request reference.
    value = {"tool": row.tool_name, "arguments": row.arguments, "endpoint": row.endpoint}
    audit = row.response_payload.get("_page_chat") if isinstance(row.response_payload, dict) else None
    if isinstance(audit, dict) and isinstance(audit.get("request"), dict):
        value["request"] = audit["request"]
    return snapshot(value)


def _tool_response(row):
    if row.response_detail is not None:
        detail = stored_detail(row.response_detail)
        if detail.get("reason") != "pending" or row.status in {"running", "approved", "awaiting_approval"}:
            return detail
    if row.status in {"running", "approved", "awaiting_approval"}:
        return unavailable("pending")
    payload = row.response_payload
    if isinstance(payload, dict) and "_page_chat" in payload:
        if "result" in payload:
            return snapshot(payload["result"])
    elif payload not in (None, {}, ""):
        return snapshot(payload)
    return unavailable("not_executed" if row.status == "rejected" else "not_recorded")


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def tool_monitor_detail(request, pk):
    actor, row, owner_id = _detail_row(request, pk, tools=True)
    labels = _user_labels([row.report_actor_key])
    payload = {"execution": {**_execution_metadata(row, labels), "tool_name": row.tool_name,
                             "tool_source": row.tool_source or row.source},
               "request": _tool_request(row), "response": _tool_response(row)}
    _audit_detail(request, actor, row, owner_id, tools=True)
    return _response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def model_monitor_detail(request, pk):
    actor, row, owner_id = _detail_row(request, pk, tools=False)
    labels = _user_labels([row.report_actor_key])
    payload = {"execution": {**_execution_metadata(row, labels), "profile_name": row.profile_name,
                             **{name: getattr(row, name) for name in (
                                 "input_tokens", "output_tokens", "cached_input_tokens", "total_tokens", "currency", "error_code",
                             )}, "estimated_cost": str(row.estimated_cost) if row.estimated_cost is not None else None},
               "request": stored_detail(row.request_detail), "response": stored_detail(row.response_detail)}
    _audit_detail(request, actor, row, owner_id, tools=False)
    return _response(payload)
