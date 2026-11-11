from __future__ import annotations

from typing import Callable

from django.http import JsonResponse
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


class DRFTokenAuthMiddleware:
    """
    Allow Django (session-based) views protected by @login_required to accept
    DRF TokenAuthentication headers: `Authorization: Token <key>`.

    Match DRF's case-insensitive token parsing and precedence over session users,
    so audit and readonly middleware see the principal used by the API view.
    """

    def __init__(self, get_response: Callable):
        self.get_response = get_response

    def __call__(self, request):
        try:
            authenticated = TokenAuthentication().authenticate(request)
        except AuthenticationFailed as exc:
            response = JsonResponse({"detail": str(exc.detail)}, status=401)
            response["WWW-Authenticate"] = "Token"
            return response
        if authenticated is not None:
            request.user, request.auth = authenticated
            request._cached_user = request.user

        return self.get_response(request)

