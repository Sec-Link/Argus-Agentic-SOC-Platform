import re

from django.contrib.auth.models import Group
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from ai_assistant.models import ExternalMCPServer, SkillConfig
from ai_assistant.tool_access import validate_use_groups


class ModelSelectionSerializer(serializers.Serializer):
    model_profile_id = serializers.UUIDField()

    def validate(self, attrs):
        # DRF ignores undeclared fields, so reject removed connection overrides explicitly.
        if any(key in self.initial_data for key in (
            "api_key", "model", "base_url", "timeout_seconds", "mcp_base_url", "mcp_servers",
            "mcp_token", "mcp_timeout_seconds", "mcp_ticket_context_path", "mcp_ticket_search_path",
            "mcp_cmdb_lookup_path", "mcp_observables_extract_path",
        )):
            raise serializers.ValidationError({
                "model_profile_id": "Select a saved model; model and MCP connection overrides are not accepted.",
            })
        return attrs


class AIAssistantRequestSerializer(ModelSelectionSerializer):
    alert_json = serializers.JSONField(required=False)
    trigger_rule = serializers.CharField(required=False, allow_blank=True)
    related_logs = serializers.JSONField(required=False)
    prompt = serializers.CharField(required=False, allow_blank=True)
    enabled = serializers.BooleanField(required=False)
    mcp_enabled = serializers.BooleanField(required=False)
    skills = serializers.JSONField(required=False)

    def validate_related_logs(self, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [str(v) for v in value]
        return [str(value)]

    def validate_skills(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        cleaned = []
        for item in value:
            if isinstance(item, dict):
                cleaned.append(item)
        return cleaned


class AIChatRequestSerializer(ModelSelectionSerializer):
    message = serializers.CharField(required=True, allow_blank=False)
    messages = serializers.JSONField(required=False)
    ticket_number = serializers.CharField(required=False, allow_blank=True)
    max_iterations = serializers.IntegerField(required=False)
    skills = serializers.JSONField(required=False)
    mcp_enabled = serializers.BooleanField(required=False)

    def validate_messages(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        cleaned = []
        for item in value:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            content = item.get("content")
            if role and content is not None:
                cleaned.append({"role": role, "content": content})
        return cleaned


class ExternalMCPServerSerializer(serializers.ModelSerializer):
    approval_policy_version = serializers.CharField(write_only=True, required=False, max_length=64)
    token = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=8192)
    clear_token = serializers.BooleanField(write_only=True, required=False, default=False)
    has_token = serializers.SerializerMethodField()
    use_group_ids = serializers.PrimaryKeyRelatedField(
        source="use_groups", queryset=Group.objects.all(), many=True, required=False,
    )

    class Meta:
        model = ExternalMCPServer
        fields = [
            "id",
            "name",
            "endpoint",
            "title",
            "token",
            "clear_token",
            "has_token",
            "enabled",
            "extra",
            "tool_approvals",
            "use_group_ids",
            "approval_policy_version",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_has_token(self, instance):
        return bool(instance.token)

    def validate_tool_approvals(self, value):
        if not isinstance(value, dict) or len(value) > 200:
            raise serializers.ValidationError("Approval policies must be an object with at most 200 tools.")
        for name, required in value.items():
            if (not isinstance(name, str) or not name.strip() or len(name) > 200
                    or re.search(r"[\x00-\x1f\x7f]", name) or type(required) is not bool):
                raise serializers.ValidationError("Each tool must have a valid name and a boolean approval policy.")
        return value

    def validate(self, attrs):
        user = validate_use_groups(self, attrs)
        version = attrs.pop("approval_policy_version", None)
        clear = attrs.pop("clear_token", False)
        if clear and attrs.get("token"):
            raise serializers.ValidationError({"token": "Replace the credential or clear it, not both."})
        if clear:
            attrs["token"] = ""
        elif not attrs.get("token"):
            attrs.pop("token", None)
        if self.instance:
            if (self.instance.token and "endpoint" in attrs and attrs["endpoint"] != self.instance.endpoint
                    and "token" not in attrs):
                raise serializers.ValidationError({
                    "token": "Changing the MCP endpoint requires a new credential or clearing the saved credential.",
                })
            rebound = any(field in attrs and attrs[field] != getattr(self.instance, field)
                          for field in ("endpoint", "token"))
            if rebound:
                # A previous server's exceptions never authorize a replacement server.
                attrs["tool_approvals"] = {}
            elif "tool_approvals" in attrs and version != self.instance.updated_at.isoformat():
                raise serializers.ValidationError({
                    "approval_policy_version": "MCP configuration changed. Reload its tools before saving approval policies.",
                })
        if not user or not user.is_superuser:
            if any(required is False for required in attrs.get("tool_approvals", {}).values()):
                raise PermissionDenied("Only a superuser can disable tool approval.")
            attrs["tool_approvals"] = {}
        return attrs

    def validate_skills(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        cleaned = []
        for item in value:
            name = str(item.get("name") or item or "").strip() if isinstance(item, dict) else str(item).strip()
            if name:
                cleaned.append(name)
        return cleaned

    def validate_mcp_servers(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            return []
        cleaned = []
        for item in value:
            if not isinstance(item, dict):
                continue
            endpoint = str(item.get("endpoint") or "").strip()
            if not endpoint:
                continue
            cleaned.append(
                {
                    "endpoint": endpoint,
                    "title": str(item.get("title") or "").strip(),
                    "token": str(item.get("token") or "").strip(),
                }
            )
        return cleaned


class SkillConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = SkillConfig
        fields = [
            "id",
            "name",
            "version",
            "route",
            "enabled",
            "description",
            "created_at",
            "updated_at",
        ]

    def create(self, validated_data):
        if not validated_data.get("route"):
            validated_data["route"] = validated_data.get("name", "")
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "route" in validated_data and not validated_data.get("route"):
            validated_data["route"] = instance.name
        return super().update(instance, validated_data)
