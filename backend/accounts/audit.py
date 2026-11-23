from __future__ import annotations

import logging
from typing import Any

from .models import AuditLog

logger = logging.getLogger(__name__)


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def request_ip(request) -> str:
    if not request:
        return ""
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or ""


def request_user_agent(request) -> str:
    if not request:
        return ""
    return (request.META.get("HTTP_USER_AGENT", "") or "")[:255]


def omit_audit_params(path, params=None):
    path = (path or "").rstrip("/")
    if path.startswith("/api/v1/tickets/"):
        action = path.rsplit("/", 1)[-1]
        if action in {"ai_assistant", "ai_mention"}:
            return True
        if action == "add_worklog" and isinstance(params, dict):
            # The ticket UI publishes AI replies and observables through the normal work-log endpoint.
            entry = params.get("log_entry")
            entries = entry[:50] if isinstance(entry, list) else [entry]
            return any(isinstance(value, str) and value.startswith(("AI Reply (@ai):", "AI Observables JSON:"))
                       for value in entries)
    return any(path == prefix or path.startswith(prefix + "/") for prefix in (
        "/api/v1/ai-assistant/chat", "/api/v1/ai-assistant/page-chat", "/api/v1/ai-assistant/http-tools",
        "/api/v1/ai-assistant/agents", "/api/v1/ai-assistant/conversations", "/api/v1/ai-assistant/models",
        "/api/v1/ai-assistant/external-mcp", "/api/v1/ai-assistant/skills",
    ))


class AuditService:
    @staticmethod
    def log_event(
        *,
        event_type: str,
        status: str,
        user_email: str | None = None,
        admin_email: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        failure_reason: str | None = None,
        metadata: dict[str, Any] | None = None,
        action_type: str = AuditLog.ActionType.AUTH,
        path: str = "",
        method: str = "",
        details: dict[str, Any] | None = None,
    ) -> None:
        data = {
            "event_type": event_type,
            "status": status,
            "action_type": action_type,
            "path": (path or "")[:512],
            "method": (method or "")[:8],
            "details": details or {},
            "user_email": _normalize_email(user_email or "") or None,
            "admin_email": _normalize_email(admin_email or "") or None,
            "ip_address": (ip_address or "")[:64],
            "user_agent": (user_agent or "")[:255],
            "failure_reason": (failure_reason or "").strip() or None,
            "metadata": metadata or {},
        }
        AuditLog.objects.create(**data)

    @staticmethod
    def log_safe(**kwargs) -> None:
        try:
            AuditService.log_event(**kwargs)
        except Exception:
            logger.exception("Failed to write audit log", extra={"audit_context": kwargs})

    @staticmethod
    def log_guest_action(user, action_type, path, method, details=None, request=None) -> None:
        # Keep activity writes isolated and JSON-safe; audit failures must never
        # interrupt the request being observed.
        AuditService.log_safe(
            event_type=AuditLog.EventType.ACTIVITY,
            status=AuditLog.Status.SUCCESS,
            action_type=action_type,
            path=path,
            method=method,
            details=dict(details or {}),
            user_email=getattr(user, "email", None),
            ip_address=request_ip(request),
            user_agent=request_user_agent(request),
        )

    @staticmethod
    def log_from_request(
        request,
        *,
        event_type: str,
        status: str,
        user_email: str | None = None,
        admin_email: str | None = None,
        failure_reason: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        AuditService.log_safe(
            event_type=event_type,
            status=status,
            user_email=user_email,
            admin_email=admin_email,
            ip_address=request_ip(request),
            user_agent=request_user_agent(request),
            failure_reason=failure_reason,
            metadata=metadata,
        )
