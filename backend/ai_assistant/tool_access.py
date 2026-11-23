"""Caller role checks shared by tool discovery and execution."""

from django.contrib.auth.models import Group
from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.permissions import DenyReadonlyUser, RbacModelPermissions
from accounts.services import is_user_readonly


def role_scoped(queryset, user):
    if (not user or not user.is_authenticated or not user.is_active or is_user_readonly(user)):
        return queryset.none()
    if user.is_superuser:
        return queryset
    return queryset.filter(use_groups__user=user).distinct()


def allowed_tools(queryset, user):
    return role_scoped(queryset.filter(enabled=True), user)


def can_use_tool(user, config):
    return allowed_tools(type(config).objects.filter(pk=config.pk), user).exists()


def require_tool_access(user, config):
    if not can_use_tool(user, config):
        raise PermissionError("You no longer have permission to use this external tool.")


class AIConfigViewSet(viewsets.ModelViewSet):
    """Lock configurations before validating changes to credentials, roles or approval policies."""
    permission_classes = (IsAuthenticated, DenyReadonlyUser, RbacModelPermissions)

    def get_queryset(self):
        rows = super().get_queryset()
        return rows.select_for_update() if self.action in {"update", "partial_update", "destroy"} else rows

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)


class GroupSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ("id", "name")


class AssignedRolesSerializer(serializers.ModelSerializer):
    use_roles = GroupSummarySerializer(source="use_groups", many=True, read_only=True)
    use_group_ids = serializers.PrimaryKeyRelatedField(
        source="use_groups", queryset=Group.objects.all(), many=True, required=False,
    )


class UseGroupSerializer(AssignedRolesSerializer):
    def to_internal_value(self, data):
        roles_supplied = isinstance(data, dict) and "use_group_ids" in data
        if roles_supplied:
            user = getattr(self.context.get("request"), "user", None)
            permission = f"ai_assistant.manage_access_{self.Meta.model._meta.model_name}"
            if not user or not user.has_perm(permission):
                raise PermissionDenied("Managing use roles requires the access management permission.")
        attrs = super().to_internal_value(data)
        if not roles_supplied:
            # DRF treats a missing multi-select in a full HTML form as an empty list.
            attrs.pop("use_groups", None)
        return attrs


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def tool_access_roles(request):
    user = request.user
    if (not user.is_active or is_user_readonly(user) or not any(user.has_perm(permission) for permission in (
        "ai_assistant.manage_access_httptoolconfig", "ai_assistant.manage_access_externalmcpserver",
        "ai_assistant.manage_access_skillconfig", "ai_assistant.manage_access_agentconfig",
    ))):
        raise PermissionDenied("Managing tool use roles requires the tool access permission.")
    return Response(list(Group.objects.order_by("name").values("id", "name")),
                    headers={"Cache-Control": "private, no-store"})
