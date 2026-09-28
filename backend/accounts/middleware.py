from __future__ import annotations

from django.http import JsonResponse

from .audit import AuditService
from .models import AuditLog
from .services import is_user_readonly, should_deny_write_for_readonly_user

# Skip noisy / irrelevant paths so activity logs stay meaningful.
_IGNORE_PREFIXES = ("/static/", "/media/", "/favicon", "/api/v1/accounts/audit")
_IGNORE_SUFFIXES = (".css", ".js", ".png", ".svg", ".ico", ".map", ".woff", ".woff2")


def extract_service_name(path: str) -> str:
    mappings = (
        ("/api/v1/alerts/", "Alerts Service"),
        ("/api/v1/detection/", "Detection Rules"),
        ("/api/v1/risk/", "Risk (RBA)"),
        ("/api/v1/reports/", "Reports Generator"),
        ("/api/v1/tickets/", "Tickets Service"),
    )
    for prefix, name in mappings:
        if path.startswith(prefix):
            return name
    return "SOC API Service"


def _is_guest(user) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    return bool(getattr(user, "is_guest", False) or getattr(user, "role", "").lower() == "guest" or is_user_readonly(user))


def _summarize(request) -> dict:
    if request.method == "GET":
        return {k: v[:200] for k, v in request.GET.items()}
    try:
        body = getattr(request, "_audit_body", None)
        if body is None and request.body:
            import json
            try: body = json.loads(request.body.decode("utf-8"))
            except Exception: body = None
        data = body if isinstance(body, dict) else dict(getattr(request, "POST", {}) or {})
        def sanitize(value, key=""):
            if any(secret in key.lower() for secret in ("password", "otp", "token", "secret", "authorization")):
                return "[REDACTED]"
            if isinstance(value, dict):
                return {str(k)[:100]: sanitize(v, str(k)) for k, v in list(value.items())[:50]}
            if isinstance(value, (list, tuple)):
                return [sanitize(v) for v in list(value)[:50]]
            return str(value)[:200]
        return sanitize(data)
    except Exception:
        return {}


class GuestActivityAuditMiddleware:
    """Record page views (GET) and feature actions (write methods) for guests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def _should_skip(self, path: str) -> bool:
        if not path.startswith("/api/v1/"):
            return True
        if any(path.startswith(p) for p in _IGNORE_PREFIXES):
            return True
        return any(path.endswith(s) for s in _IGNORE_SUFFIXES)

    def __call__(self, request):
        path = request.path or ""
        user = getattr(request, "user", None)
        should_log = not self._should_skip(path) and _is_guest(user)
        summary = _summarize(request) if should_log else {}
        response = self.get_response(request)
        try:
            if should_log:
                is_write = request.method not in ("GET", "HEAD", "OPTIONS")
                action = AuditLog.ActionType.FEATURE_EXEC if is_write else AuditLog.ActionType.PAGE_VIEW
                AuditService.log_guest_action(
                    user=user,
                    action_type=action,
                    path=path,
                    method=request.method,
                    details={"service": extract_service_name(path), "path": path, "method": request.method, "status_code": getattr(response, "status_code", None), "params": summary},
                    request=request,
                )
        except Exception:
            pass
        return response


class ReadonlyWriteBlockMiddleware:
    """
    Deny non-safe API methods for readonly users across all modules.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ""
        if path.startswith("/api/v1/"):
            user = getattr(request, "user", None)
            if should_deny_write_for_readonly_user(user, path=path, method=request.method):
                return JsonResponse(
                    {"detail": "Readonly users cannot modify data."},
                    status=403,
                )
        return self.get_response(request)
