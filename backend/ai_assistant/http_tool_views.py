"""Permission-controlled HTTP tool configuration; credentials are write-only."""

import re

from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.permissions import DenyReadonlyUser, RbacModelPermissions
from .http_tool_crypto import encrypt_http_tool_secret
from .http_tools import validate_tool_config
from .models import HttpToolConfig


class HttpToolSerializer(serializers.ModelSerializer):
    auth_secret = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=8192, trim_whitespace=False)
    clear_auth_secret = serializers.BooleanField(write_only=True, required=False, default=False)
    has_auth_secret = serializers.SerializerMethodField()
    auth_prefix = serializers.CharField(required=False, allow_blank=True, max_length=40, trim_whitespace=False)

    class Meta:
        model = HttpToolConfig
        fields = (
            "id", "name", "description", "enabled", "method", "url", "parameters", "query_params",
            "body_template", "auth_type", "auth_header", "auth_prefix", "auth_secret", "clear_auth_secret",
            "has_auth_secret", "timeout_seconds", "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def get_has_auth_secret(self, instance):
        return bool(instance.encrypted_auth_secret)

    def validate(self, attrs):
        current = self.instance or HttpToolConfig()
        config = {**current.as_tool_config(), **attrs}
        try:
            normalized = validate_tool_config(config)
        except ValueError as exc:
            raise serializers.ValidationError({"configuration": str(exc)}) from None
        attrs.update(normalized)
        secret = attrs.get("auth_secret", "")
        clear = attrs.get("clear_auth_secret", False)
        if secret and (not secret.strip() or re.search(r"[^\x20-\x7e]", secret)):
            raise serializers.ValidationError({"auth_secret": "Credential must contain only printable ASCII characters."})
        if secret and clear:
            raise serializers.ValidationError({"auth_secret": "Provide a replacement credential or clear it, not both."})
        if normalized["auth_type"] == "none":
            if secret:
                raise serializers.ValidationError({"auth_secret": "Choose Bearer or Header authentication before adding a credential."})
            attrs["clear_auth_secret"] = clear = True
        target_fields = ("url", "method", "auth_type", "auth_header", "auth_prefix")
        if current.encrypted_auth_secret and not (secret or clear) and any(
            normalized[field] != getattr(current, field) for field in target_fields
        ):
            raise serializers.ValidationError({
                "auth_secret": "Changing the request target or authentication requires a new credential or clearing the saved credential.",
            })
        has_secret = bool(secret or current.encrypted_auth_secret and not clear)
        if config["enabled"] and normalized["auth_type"] != "none" and not has_secret:
            raise serializers.ValidationError({"auth_secret": "Add a credential before enabling this authenticated tool."})
        return attrs

    @staticmethod
    def _apply_secret(validated_data):
        secret = validated_data.pop("auth_secret", "")
        clear = validated_data.pop("clear_auth_secret", False)
        if clear:
            validated_data["encrypted_auth_secret"] = ""
        elif secret:
            validated_data["encrypted_auth_secret"] = encrypt_http_tool_secret(secret)

    def create(self, validated_data):
        self._apply_secret(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._apply_secret(validated_data)
        return super().update(instance, validated_data)


class HttpToolPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class HttpToolViewSet(viewsets.ModelViewSet):
    queryset = HttpToolConfig.objects.order_by("name")
    serializer_class = HttpToolSerializer
    permission_classes = (IsAuthenticated, DenyReadonlyUser, RbacModelPermissions)
    lookup_field = "name"
    pagination_class = HttpToolPagination

    def _audit(self, instance, action):
        # Deliberately omit URL, templates, headers and submitted payloads.
        AuditService.log_event(
            event_type=AuditLog.EventType.ACTIVITY, status=AuditLog.Status.SUCCESS,
            action_type=AuditLog.ActionType.FEATURE_EXEC,
            user_email=getattr(self.request.user, "email", None),
            ip_address=request_ip(self.request), user_agent=request_user_agent(self.request),
            path=self.request.path, method=self.request.method,
            metadata={"resource": "http_tool", "id": instance.pk, "name": instance.name, "actor_id": self.request.user.pk,
                      "action": action, "enabled": instance.enabled},
        )

    @transaction.atomic
    def perform_create(self, serializer):
        self._audit(serializer.save(), "create")

    @transaction.atomic
    def perform_update(self, serializer):
        self._audit(serializer.save(), "update")

    @transaction.atomic
    def perform_destroy(self, instance):
        self._audit(instance, "delete")
        instance.delete()
