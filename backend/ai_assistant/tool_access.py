"""Caller role checks shared by tool discovery and execution."""

from django.contrib.auth.models import Group
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.services import is_user_readonly


def allowed_tools(queryset, user):
    if (not user or not user.is_authenticated or not user.is_active or is_user_readonly(user)):
        return queryset.none()
    queryset = queryset.filter(enabled=True)
    if user.is_superuser:
        return queryset
    return queryset.filter(use_groups__user=user).distinct()


def can_use_tool(user, config):
    return allowed_tools(type(config).objects.filter(pk=config.pk), user).exists()


def require_tool_access(user, config):
    if not can_use_tool(user, config):
        raise PermissionError("You no longer have permission to use this external tool.")


def validate_use_groups(serializer, attrs):
    user = getattr(serializer.context.get("request"), "user", None)
    model_name = serializer.Meta.model._meta.model_name
    if "use_groups" in attrs and (not user or not user.has_perm(f"ai_assistant.manage_access_{model_name}")):
        raise PermissionDenied("Managing tool use roles requires the tool access permission.")
    return user


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def tool_access_roles(request):
    user = request.user
    if (not user.is_active or is_user_readonly(user) or not any(user.has_perm(permission) for permission in (
        "ai_assistant.manage_access_httptoolconfig", "ai_assistant.manage_access_externalmcpserver",
    ))):
        raise PermissionDenied("Managing tool use roles requires the tool access permission.")
    return Response(list(Group.objects.order_by("name").values("id", "name")),
                    headers={"Cache-Control": "private, no-store"})
