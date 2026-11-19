from __future__ import annotations

from typing import Callable

from django.http import JsonResponse
from django.urls import Resolver404, resolve
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.views import APIView


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
            try:
                callback = resolve(request.path_info, getattr(request, "urlconf", None)).func
            except Resolver404:
                callback = None
            view_class = getattr(callback, "cls", None)
            if isinstance(view_class, type) and issubclass(view_class, APIView):
                authentication_classes = callback.initkwargs.get(
                    "authentication_classes", view_class.authentication_classes,
                )
                # Respect views that explicitly opt out of authentication, not merely AllowAny.
                if authentication_classes in ([], ()):
                    return self.get_response(request)
            response = JsonResponse({"detail": str(exc.detail)}, status=401)
            response["WWW-Authenticate"] = "Token"
            return response
        if authenticated is not None:
            request.user, request.auth = authenticated
            request._cached_user = request.user

        return self.get_response(request)

