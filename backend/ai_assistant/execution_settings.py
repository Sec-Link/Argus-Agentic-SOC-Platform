"""Managed execution limits, captured once for each page-chat request."""

from dataclasses import dataclass, fields

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.permissions import DenyReadonlyUser, RbacModelPermissions
from .models import ExecutionSettings


@dataclass(frozen=True)
class ExecutionLimits:
    execution_timeout_seconds: int
    approval_timeout_seconds: int
    max_iterations: int
    coordinator_max_iterations: int
    max_delegations: int


LIMIT_FIELDS = tuple(field.name for field in fields(ExecutionLimits))


def get_execution_limits() -> ExecutionLimits:
    # An absent policy uses model defaults without writing during a chat/read.
    # Database errors remain errors: an unapplied migration must be visible.
    instance = ExecutionSettings.objects.filter(pk=1).first() or ExecutionSettings(pk=1)
    return ExecutionLimits(**{name: getattr(instance, name) for name in LIMIT_FIELDS})


class ExecutionSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExecutionSettings
        fields = LIMIT_FIELDS

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(LIMIT_FIELDS)
            if unknown:
                raise serializers.ValidationError({"detail": "Unknown execution setting."})
            invalid = {name: "Enter a whole number." for name, value in data.items() if type(value) is not int}
            if invalid:
                raise serializers.ValidationError(invalid)
        return super().to_internal_value(data)

    def validate(self, attrs):
        current = self.instance or ExecutionSettings(pk=1)
        execution = attrs.get("execution_timeout_seconds", current.execution_timeout_seconds)
        approval = attrs.get("approval_timeout_seconds", current.approval_timeout_seconds)
        if approval > execution:
            raise serializers.ValidationError({
                "approval_timeout_seconds": "Approval timeout cannot exceed the whole-turn timeout.",
            })
        return attrs


class ExecutionSettingsViewSet(viewsets.GenericViewSet):
    queryset = ExecutionSettings.objects.all()
    serializer_class = ExecutionSettingsSerializer
    permission_classes = (IsAuthenticated, DenyReadonlyUser, RbacModelPermissions)
    http_method_names = ("get", "patch", "head", "options")

    def retrieve(self, request):
        instance = self.get_queryset().filter(pk=1).first() or ExecutionSettings(pk=1)
        return Response(self.get_serializer(instance).data, headers={"Cache-Control": "private, no-store"})

    @transaction.atomic
    def partial_update(self, request):
        # This row exists before the singleton is first saved; serialize partial
        # updates so concurrent first saves cannot overwrite another field.
        ContentType.objects.select_for_update().get(app_label="ai_assistant", model="executionsettings")
        instance = self.get_queryset().filter(pk=1).first() or ExecutionSettings(pk=1)
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        AuditService.log_event(
            event_type=AuditLog.EventType.ACTIVITY, status=AuditLog.Status.SUCCESS,
            action_type=AuditLog.ActionType.FEATURE_EXEC,
            user_email=getattr(request.user, "email", None),
            ip_address=request_ip(request), user_agent=request_user_agent(request),
            path=request.path, method=request.method,
            metadata={"resource": "execution_settings", "actor_id": request.user.pk,
                      "action": "update", "limits": dict(serializer.data)},
        )
        return Response(serializer.data, headers={"Cache-Control": "private, no-store"})
