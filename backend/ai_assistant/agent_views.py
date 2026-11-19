"""Agent role configuration and the bounded mention catalog for chat operators."""

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.permissions import DenyReadonlyUser, RbacModelPermissions
from accounts.services import is_user_readonly
from .models import AgentConfig


MAX_AGENT_CONFIGS = 50


class AgentConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentConfig
        fields = (
            "id", "name", "title", "role", "instructions", "enabled", "max_iterations", "max_delegations",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_name(self, value):
        if value in {"coordinator", "catalog"}:
            raise serializers.ValidationError("This agent name is reserved.")
        return value


class AgentConfigPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class AgentConfigViewSet(viewsets.ModelViewSet):
    queryset = AgentConfig.objects.order_by("name")
    serializer_class = AgentConfigSerializer
    permission_classes = (IsAuthenticated, DenyReadonlyUser, RbacModelPermissions)
    lookup_field = "name"
    pagination_class = AgentConfigPagination

    def _audit(self, instance, action):
        # Role prompts belong in configuration, never in activity logs.
        AuditService.log_event(
            event_type=AuditLog.EventType.ACTIVITY, status=AuditLog.Status.SUCCESS,
            action_type=AuditLog.ActionType.FEATURE_EXEC,
            user_email=getattr(self.request.user, "email", None),
            ip_address=request_ip(self.request), user_agent=request_user_agent(self.request),
            path=self.request.path, method=self.request.method,
            metadata={"resource": "agent", "id": instance.pk, "name": instance.name, "actor_id": self.request.user.pk,
                      "action": action, "enabled": instance.enabled,
                      "max_iterations": instance.max_iterations, "max_delegations": instance.max_delegations},
        )

    @transaction.atomic
    def perform_create(self, serializer):
        # Serialize creates even when no agents exist yet, using an existing row.
        ContentType.objects.select_for_update().get(app_label="ai_assistant", model="agentconfig")
        if AgentConfig.objects.count() >= MAX_AGENT_CONFIGS:
            raise serializers.ValidationError({"detail": f"At most {MAX_AGENT_CONFIGS} agents may be configured."})
        self._audit(serializer.save(), "create")

    @transaction.atomic
    def perform_update(self, serializer):
        self._audit(serializer.save(), "update")

    @transaction.atomic
    def perform_destroy(self, instance):
        self._audit(instance, "delete")
        instance.delete()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agent_catalog(request):
    if is_user_readonly(request.user):
        return Response({"detail": "Readonly users cannot use the AI assistant."}, status=403)
    return Response(list(
        AgentConfig.objects.filter(enabled=True).order_by("name").values("name", "title", "role")[:MAX_AGENT_CONFIGS]
    ))
