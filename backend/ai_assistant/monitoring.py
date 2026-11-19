import math
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.db.models import Count, F, Max, Q
from django.utils import timezone

from ai_assistant.models import MCPToolExecution, MCPToolStats, SkillStats, PageChatConversation
from .call_details import snapshot, unavailable


def _detail_permissions(tool_name, context, arguments=None):
    from .conversation_history import event_permissions
    required = event_permissions({
        "tool": tool_name, "arguments": arguments, "source": context.get("tool_source") or None,
    })
    if context.get("source") in {"ticket_chat", "ticket_analysis", "ticket_mention"}:
        required.add("tickets.view_eventticket")
    if context.get("conversation_id"):
        required.update(PageChatConversation.objects.filter(pk=context["conversation_id"]).values_list(
            "required_permissions", flat=True,
        ).first() or [])
    return sorted(required)


def start_mcp_execution(
    tool_name: str,
    arguments: Optional[Dict[str, Any]] = None,
    source: str = "",
    endpoint: str = "",
    *, audit_context=None,
) -> str:
    context = audit_context or {}
    attribution = {key: context[key] for key in (
        "actor_id", "actor_label", "request_id", "conversation_id", "model_profile_id",
        "model_name", "agent_name", "tool_source",
    ) if key in context}
    exec_row = MCPToolExecution.objects.create(
        tool_name=tool_name or "",
        arguments=arguments or {},
        status="running",
        source=source or "",
        endpoint=endpoint or "",
        request_detail=snapshot({"tool": tool_name or "", "arguments": arguments or {}, "endpoint": endpoint or ""}),
        response_detail=unavailable("pending"),
        detail_permissions=_detail_permissions(tool_name, context, arguments),
        **attribution,
    )
    return str(exec_row.id)


def finish_mcp_execution(exec_id: str, success: bool, error: str = "", *, response_payload: Any = None) -> None:
    if not exec_id:
        return
    now = timezone.now()
    row = MCPToolExecution.objects.filter(id=exec_id).first()
    if not row:
        return
    duration_ms = None
    if row.start_time:
        duration_ms = int(max(0, (now - row.start_time).total_seconds() * 1000))
    if row.status not in {"rejected", "cancelled"}:
        row.status = "completed" if success else "failed"
    row.error = (error or "")[:2000]
    row.end_time = now
    row.duration_ms = duration_ms
    update_fields = ["status", "error", "end_time", "duration_ms"]
    if row.status == "rejected":
        row.response_detail = unavailable("not_executed")
    elif response_payload is not None:
        row.response_detail = snapshot(response_payload)
    else:
        row.response_detail = unavailable("unavailable")
    update_fields.append("response_detail")
    row.detail_permissions = sorted(set(row.detail_permissions or []) | set(_detail_permissions(
        row.tool_name, {"conversation_id": row.conversation_id, "source": row.source,
                        "tool_source": row.tool_source}, row.arguments,
    )))
    update_fields.append("detail_permissions")
    page_audit = row.response_payload.get("_page_chat") if isinstance(row.response_payload, dict) else None
    # Legacy executions have no owner; do not publish new chat evidence there.
    if (response_payload is not None and row.source == "page_chat"
            and isinstance(page_audit, dict) and page_audit.get("user_id")):
        row.response_payload = {"result": response_payload, "_page_chat": page_audit}
        update_fields.append("response_payload")
    row.save(update_fields=update_fields)


def update_mcp_stats(tool_name: str, success: bool) -> None:
    if not tool_name:
        return
    now = timezone.now()
    with transaction.atomic():
        stats, created = MCPToolStats.objects.select_for_update().get_or_create(tool_name=tool_name)
        MCPToolStats.objects.filter(id=stats.id).update(
            total_calls=F("total_calls") + 1,
            success_calls=F("success_calls") + (1 if success else 0),
            failed_calls=F("failed_calls") + (0 if success else 1),
            last_call_time=now,
        )


def record_skill_call(skill_name: str, success: bool) -> None:
    if not skill_name:
        return
    now = timezone.now()
    with transaction.atomic():
        stats, created = SkillStats.objects.select_for_update().get_or_create(skill_name=skill_name)
        SkillStats.objects.filter(id=stats.id).update(
            total_calls=F("total_calls") + 1,
            success_calls=F("success_calls") + (1 if success else 0),
            failed_calls=F("failed_calls") + (0 if success else 1),
            last_call_time=now,
        )


def _serialize_execution(row: MCPToolExecution) -> Dict[str, Any]:
    return {
        "id": str(row.id),
        "tool_name": row.tool_name,
        "status": row.status,
        "start_time": row.start_time.isoformat() if row.start_time else "",
        "end_time": row.end_time.isoformat() if row.end_time else "",
        "duration_ms": row.duration_ms,
        "source": row.source,
    }


def _serialize_stats(row: MCPToolStats) -> Dict[str, Any]:
    return {
        "tool_name": row.tool_name,
        "total_calls": row.total_calls,
        "success_calls": row.success_calls,
        "failed_calls": row.failed_calls,
        "last_call_time": row.last_call_time.isoformat() if row.last_call_time else "",
    }


def _serialize_skill_stats(row: SkillStats) -> Dict[str, Any]:
    return {
        "skill_name": row.skill_name,
        "total_calls": row.total_calls,
        "success_calls": row.success_calls,
        "failed_calls": row.failed_calls,
        "last_call_time": row.last_call_time.isoformat() if row.last_call_time else "",
    }


def get_mcp_monitor(
    page: int, page_size: int, status: str = "", tool_name: str = "", *, user_id=None,
) -> Dict[str, Any]:
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 20), 100))

    qs = MCPToolExecution.objects.all().order_by("-start_time")
    # Page-chat evidence belongs to its actor, including counts and pagination.
    visible = Q(pk__in=[])
    if user_id is not None:
        visible = Q(actor_id=user_id) | Q(actor__isnull=True, source="page_chat", response_payload___page_chat__user_id=user_id)
    qs = qs.filter(visible).defer("arguments", "response_payload", "error", "endpoint",
                                  "request_detail", "response_detail", "detail_permissions")
    if status:
        qs = qs.filter(status=status)
    if tool_name:
        qs = qs.filter(tool_name__icontains=tool_name)

    total = qs.count()
    offset = (page - 1) * page_size
    rows = list(qs[offset : offset + page_size])
    total_pages = max(1, int(math.ceil(total / float(page_size))) if page_size else 1)

    stats_rows = qs.order_by().values("tool_name").annotate(
        total_calls=Count("pk"), success_calls=Count("pk", filter=Q(status="completed")),
        failed_calls=Count("pk", filter=Q(status__in=("failed", "rejected", "cancelled"))), last_call_time=Max("start_time"),
    )
    stats = {row["tool_name"]: row for row in stats_rows}

    return {
        "executions": [_serialize_execution(r) for r in rows],
        "stats": stats,
        "timestamp": timezone.now().isoformat(),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def get_skill_monitor() -> Dict[str, Any]:
    rows = list(SkillStats.objects.all().order_by("skill_name"))
    total_calls = sum(r.total_calls for r in rows)
    total_success = sum(r.success_calls for r in rows)
    total_failed = sum(r.failed_calls for r in rows)
    return {
        "summary": {
            "total_calls": total_calls,
            "success": total_success,
            "failed": total_failed,
        },
        "stats": [_serialize_skill_stats(r) for r in rows],
        "timestamp": timezone.now().isoformat(),
    }
