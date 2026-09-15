from __future__ import annotations

from django.http import JsonResponse

from .audit import AuditService
from .models import AuditLog
from .services import should_deny_write_for_readonly_user

# Skip noisy / irrelevant paths so activity logs stay meaningful.
_IGNORE_PREFIXES = ("/static/", "/media/", "/favicon", "/api/v1/accounts/audit")
_IGNORE_SUFFIXES = (".css", ".js", ".png", ".svg", ".ico", ".map", ".woff", ".woff2")


def _is_guest(user) -> bool:
    return bool(
        getattr(user, "is_authenticated", False)
        and (getattr(user, "is_guest", False) or getattr(user, "is_readonly", False))
    )


def _summarize(request) -> dict:
    if request.method == "GET":
        return {k: v[:200] for k, v in request.GET.items()}
    try:
        body = getattr(request, "_audit_body", None)
        data = body if isinstance(body, dict) else dict(getattr(request, "POST", {}) or {})
        # Never store secrets.
        return {k: (str(v)[:200]) for k, v in data.items() if "password" not in k.lower() and "otp" not in k.lower()}
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
        response = self.get_response(request)
        try:
            path = request.path or ""
            user = getattr(request, "user", None)
            if not self._should_skip(path) and _is_guest(user):
                is_write = request.method not in ("GET", "HEAD", "OPTIONS")
                action = AuditLog.ActionType.FEATURE_EXEC if is_write else AuditLog.ActionType.PAGE_VIEW
                AuditService.log_guest_action(
                    user=user,
                    action_type=action,
                    path=path,
                    method=request.method,
                    details={"status_code": getattr(response, "status_code", None), "params": _summarize(request)},
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
