"""Server-managed model connections and a credential-free chat catalog."""

import re
from urllib.parse import urlsplit

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.permissions import DenyReadonlyUser, RbacModelPermissions
from accounts.services import is_user_readonly
from .model_secret_crypto import decrypt_model_api_key, encrypt_model_api_key
from .models import ModelProfile
from .usage_recording import model_usage_context, profile_usage_context


MAX_MODEL_PROFILES = 50
MODEL_PROFILE_UNAVAILABLE = "The selected model is unavailable or its configuration changed. Refresh the model list and select an enabled model."


class ModelProfileUnavailable(APIException):
    status_code = 409
    default_detail = MODEL_PROFILE_UNAVAILABLE
    default_code = "model_profile_unavailable"


def validate_model_base_url(value):
    """Validate syntax only; management permission authorizes the configured target."""
    try:
        if re.search(r"[\x00-\x20\x7f\\]", value):
            raise ValueError
        parsed = urlsplit(value)
        if (parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment or "?" in value or "#" in value
                or parsed.port == 0):
            raise ValueError
        parsed.hostname.encode("idna")
    except (ValueError, UnicodeError):
        raise serializers.ValidationError("Use an HTTP(S) base URL without credentials, query parameters or fragments.") from None
    return value.rstrip("/")


class ModelProfileSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=4096, trim_whitespace=False)
    clear_api_key = serializers.BooleanField(write_only=True, required=False, default=False)
    has_api_key = serializers.SerializerMethodField()
    base_url = serializers.CharField(max_length=2000, trim_whitespace=False, validators=[validate_model_base_url])

    class Meta:
        model = ModelProfile
        fields = (
            "id", "name", "model", "base_url", "timeout_seconds", "enabled", "api_key", "clear_api_key",
            "has_api_key", "created_at", "updated_at",
            "input_price_per_million", "output_price_per_million", "cached_input_price_per_million", "currency",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def get_has_api_key(self, instance):
        return bool(instance.encrypted_api_key)

    def to_internal_value(self, data):
        writable = set(self.fields) - set(self.Meta.read_only_fields) - {"has_api_key"}
        if not isinstance(data, dict) or set(data) - writable:
            raise serializers.ValidationError({"detail": "Only writable model configuration fields are accepted."})
        if "timeout_seconds" in data and type(data["timeout_seconds"]) is not int:
            raise serializers.ValidationError({"timeout_seconds": "Enter a whole number from 1 to 120."})
        return super().to_internal_value(data)

    def validate_base_url(self, value):
        return validate_model_base_url(value)

    def validate_currency(self, value):
        if not re.fullmatch(r"[A-Z]{3}", value):
            raise serializers.ValidationError("Use a three-letter uppercase currency code.")
        return value

    def validate(self, attrs):
        current = self.instance or ModelProfile()
        secret, clear = attrs.get("api_key", ""), attrs.get("clear_api_key", False)
        if secret and (secret != secret.strip() or re.search(r"[^\x21-\x7e]", secret)):
            raise serializers.ValidationError({"api_key": "API key must contain printable ASCII characters without spaces."})
        if secret and clear:
            raise serializers.ValidationError({"api_key": "Provide a replacement API key or clear it, not both."})
        if current.encrypted_api_key and attrs.get("base_url", current.base_url) != current.base_url and not (secret or clear):
            raise serializers.ValidationError({"api_key": "Changing the base URL requires a replacement API key or clearing the saved key."})
        has_key = bool(secret or current.encrypted_api_key and not clear)
        if attrs.get("enabled", current.enabled) and not has_key:
            raise serializers.ValidationError({"api_key": "Add an API key before enabling this model."})
        return attrs

    @staticmethod
    def _apply_key(validated_data):
        secret = validated_data.pop("api_key", "")
        clear = validated_data.pop("clear_api_key", False)
        if clear:
            validated_data["encrypted_api_key"] = ""
        elif secret:
            validated_data["encrypted_api_key"] = encrypt_model_api_key(secret)

    def create(self, validated_data):
        self._apply_key(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._apply_key(validated_data)
        return super().update(instance, validated_data)


class ModelProfilePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 50


class ModelProfileViewSet(viewsets.ModelViewSet):
    queryset = ModelProfile.objects.order_by("name")
    serializer_class = ModelProfileSerializer
    permission_classes = (IsAuthenticated, DenyReadonlyUser, RbacModelPermissions)
    pagination_class = ModelProfilePagination
    rbac_action_perms = {"test_connection": "view"}

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_for_update() if self.action in {"update", "partial_update", "destroy"} else queryset

    def _audit(self, instance, action, *, status=AuditLog.Status.SUCCESS):
        AuditService.log_event(
            event_type=AuditLog.EventType.ACTIVITY, status=status,
            action_type=AuditLog.ActionType.FEATURE_EXEC,
            user_email=getattr(self.request.user, "email", None),
            ip_address=request_ip(self.request), user_agent=request_user_agent(self.request),
            path=self.request.path, method=self.request.method,
            metadata={"resource": "model_profile", "id": str(instance.pk), "actor_id": self.request.user.pk,
                      "action": action, "enabled": instance.enabled},
        )

    @transaction.atomic
    def perform_create(self, serializer):
        ContentType.objects.select_for_update().get(app_label="ai_assistant", model="modelprofile")
        if ModelProfile.objects.count() >= MAX_MODEL_PROFILES:
            raise serializers.ValidationError({"detail": f"At most {MAX_MODEL_PROFILES} models may be configured."})
        self._audit(serializer.save(), "create")

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        self._audit(serializer.save(), "update")

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        self._audit(instance, "delete")
        instance.delete()

    def test_connection(self, request, *args, **kwargs):
        from .assistant import AIAssistantError, test_openai_connectivity
        from .chat_errors import safe_chat_error
        from .model_client import ModelCallError

        if not isinstance(request.data, dict) or request.data:
            raise serializers.ValidationError({"detail": "This test only uses the saved model configuration. Send an empty object."})
        profile = self.get_object()
        overrides, metadata, guard = resolve_model_profile(request.user, profile.pk, allow_disabled=True)
        overrides["_usage_context"] = model_usage_context(request.user, source="connectivity_test", overrides=overrides)
        try:
            guard()
            test_openai_connectivity(overrides=overrides)
            guard()
        except PermissionDenied:
            raise
        except Exception as exc:
            cause = exc.__cause__ if isinstance(exc, AIAssistantError) and isinstance(exc.__cause__, ModelCallError) else exc
            diagnostic = safe_chat_error(cause)
            self._audit(profile, "test", status=AuditLog.Status.FAILURE)
            return Response({"ok": False, "error": diagnostic["message"], "code": diagnostic["code"]}, status=503)
        self._audit(profile, "test")
        return Response({"ok": True, "model": metadata["model"]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def model_catalog(request):
    if not request.user.is_active or is_user_readonly(request.user):
        raise PermissionDenied("Readonly or inactive users cannot use the AI assistant.")
    response = Response(list(ModelProfile.objects.filter(enabled=True).exclude(encrypted_api_key="").order_by("name").values(
        "id", "name", "model",
    )[:MAX_MODEL_PROFILES]))
    response["Cache-Control"] = "private, no-store"
    return response


def resolve_model_profile(user, profile_id, *, allow_disabled=False):
    """Return private connection overrides, safe metadata and a fresh-use guard."""
    actor = get_user_model().objects.filter(pk=getattr(user, "pk", None), is_active=True).first()
    if actor is None or is_user_readonly(actor):
        raise PermissionDenied("This user cannot use the AI assistant.")
    if allow_disabled and not actor.has_perm("ai_assistant.view_modelprofile"):
        raise PermissionDenied("Model configuration access is required to test a saved model.")
    filters = {} if allow_disabled else {"enabled": True}
    profile = ModelProfile.objects.filter(pk=profile_id, **filters).first()
    if profile is None or not profile.encrypted_api_key:
        raise ModelProfileUnavailable()
    try:
        api_key = decrypt_model_api_key(profile.encrypted_api_key)
    except ValueError:
        raise ModelProfileUnavailable() from None
    if not api_key:
        raise ModelProfileUnavailable()
    profile_pk, version, actor_pk = profile.pk, profile.updated_at, actor.pk

    def guard():
        from .model_client import ModelCallError

        current_actor = get_user_model().objects.filter(pk=actor_pk, is_active=True).first()
        if current_actor is None or is_user_readonly(current_actor):
            raise PermissionDenied("This user can no longer use the AI assistant.")
        if allow_disabled and not current_actor.has_perm("ai_assistant.view_modelprofile"):
            raise PermissionDenied("Model configuration access is required to test a saved model.")
        if not ModelProfile.objects.filter(pk=profile_pk, updated_at=version, **filters).exists():
            raise ModelCallError(MODEL_PROFILE_UNAVAILABLE, code="model_profile_unavailable")

    return (
        {"api_key": api_key, "model": profile.model, "base_url": profile.base_url, "timeout_seconds": profile.timeout_seconds,
         "_usage_context": profile_usage_context(profile)},
        {"id": str(profile.pk), "name": profile.name, "model": profile.model},
        guard,
    )
