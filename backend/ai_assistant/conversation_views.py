"""Owner-managed conversations with explicitly authorized, read-only review."""

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.permissions import DenyReadonlyUser
from accounts.services import is_user_readonly
from .conversation_history import (
    MAX_CONVERSATIONS, MAX_TURNS, ConversationConflict, ConversationLimit, clean_public,
    current_actor, recover_expired, require_history_permissions,
)
from .models import PageChatConversation, PageChatTurn


REVIEW_ALL_PERMISSION = "ai_assistant.review_all_pagechatconversation"


class ConversationFilterSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=("mine", "all"), required=False)
    owner = serializers.CharField(max_length=150, required=False, allow_blank=True)
    owner_id = serializers.IntegerField(min_value=1, required=False)


class ConversationTitleSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=120, default="New conversation")

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - {"title"}:
            raise serializers.ValidationError({"detail": "Only the conversation title may be supplied."})
        return super().to_internal_value(data)

    def validate_title(self, value):
        value = clean_public(value)
        if len(value) > 120:
            raise serializers.ValidationError("The sanitized title must be at most 120 characters.")
        return value


class ConversationSummarySerializer(serializers.ModelSerializer):
    active = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    owner = serializers.SerializerMethodField()
    readonly = serializers.SerializerMethodField()
    can_continue = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = PageChatConversation
        fields = ("id", "title", "created_at", "updated_at", "revision", "active", "owner",
                  "readonly", "can_continue", "can_manage")

    def get_active(self, conversation):
        return bool(conversation.active_request_id and conversation.active_until
                    and conversation.active_until > timezone.now())

    def get_title(self, conversation):
        actor = self.context["actor"]
        reviewing_other = conversation.owner_id != actor.pk and self.context["can_view_all"]
        if not reviewing_other and not all(
            actor.has_perm(permission) for permission in conversation.required_permissions
        ):
            return "Restricted conversation"
        return conversation.title

    def get_owner(self, conversation):
        return {"id": conversation.owner_id, "username": conversation.owner.get_username()}

    def get_can_manage(self, conversation):
        return conversation.owner_id == self.context["actor"].pk and not self.context["actor_readonly"]

    def get_readonly(self, conversation):
        return not self.get_can_manage(conversation)

    def get_can_continue(self, conversation):
        return (self.get_can_manage(conversation) and not self.get_active(conversation)
                and all(self.context["actor"].has_perm(permission) for permission in conversation.required_permissions))


class ConversationTurnSerializer(serializers.ModelSerializer):
    class Meta:
        model = PageChatTurn
        fields = (
            "id", "request_id", "message", "page_context", "agent_names", "context_options", "events",
            "response", "status", "created_at", "finished_at",
        )


class ConversationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50


class ConversationViewSet(viewsets.GenericViewSet):
    permission_classes = (IsAuthenticated, DenyReadonlyUser)
    pagination_class = ConversationPagination
    serializer_class = ConversationSummarySerializer

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def get_queryset(self):
        self._history_actor = current_actor(self.request.user, write=self.action not in {"list", "retrieve"})
        rows = PageChatConversation.objects.select_related("owner").order_by("-updated_at", "-id")
        can_view_all = self._history_actor.has_perm(REVIEW_ALL_PERMISSION)
        # Review access never grants ownership or mutation rights.
        if self.action not in {"list", "retrieve"} or not can_view_all:
            rows = rows.filter(owner=self._history_actor)
        if self.action == "list":
            filters = ConversationFilterSerializer(data=self.request.query_params)
            filters.is_valid(raise_exception=True)
            values = filters.validated_data
            if not can_view_all and (values.get("scope") == "all" or values.get("owner") or values.get("owner_id")):
                raise PermissionDenied("You can only view your own conversation history.")
            if values.get("scope") == "mine":
                rows = rows.filter(owner=self._history_actor)
            if values.get("owner"):
                rows = rows.filter(owner__username__icontains=values["owner"])
            if values.get("owner_id"):
                rows = rows.filter(owner_id=values["owner_id"])
        return rows

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if not hasattr(self, "_history_actor"):
            self._history_actor = current_actor(self.request.user)
        context["actor"] = self._history_actor
        context["actor_readonly"] = is_user_readonly(self._history_actor)
        context["can_view_all"] = self._history_actor.has_perm(REVIEW_ALL_PERMISSION)
        return context

    def _locked_conversation(self, pk):
        conversation = self.get_queryset().select_for_update().filter(pk=pk).first()
        if conversation is None:
            raise NotFound("Conversation not found.")
        return conversation

    def _audit(self, instance, action):
        AuditService.log_event(
            event_type=AuditLog.EventType.ACTIVITY, status=AuditLog.Status.SUCCESS,
            action_type=AuditLog.ActionType.FEATURE_EXEC,
            user_email=getattr(self.request.user, "email", None),
            ip_address=request_ip(self.request), user_agent=request_user_agent(self.request),
            path=self.request.path, method=self.request.method,
            metadata={"resource": "page_chat_conversation", "id": str(instance.pk),
                      "actor_id": self.request.user.pk, "owner_id": instance.owner_id, "action": action},
        )

    def list(self, request):
        rows = self.paginate_queryset(self.get_queryset())
        response = self.get_paginated_response(self.get_serializer(rows, many=True).data)
        response.data["can_view_all"] = self._history_actor.has_perm(REVIEW_ALL_PERMISSION)
        return response

    @transaction.atomic
    def create(self, request):
        serializer = ConversationTitleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = current_actor(request.user, write=True)
        # Serialize creation for this owner, including their first conversation.
        get_user_model().objects.select_for_update().get(pk=actor.pk)
        if PageChatConversation.objects.filter(owner=actor).count() >= MAX_CONVERSATIONS:
            raise ConversationLimit("You have reached the conversation limit. Delete an unneeded conversation before creating another.")
        conversation = PageChatConversation.objects.create(owner=actor, **serializer.validated_data)
        self._audit(conversation, "create")
        return Response(self.get_serializer(conversation).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def retrieve(self, request, pk=None):
        conversation = self._locked_conversation(pk)
        if conversation.owner_id == self._history_actor.pk:
            require_history_permissions(self._history_actor, conversation.required_permissions)
            recover_expired(conversation)
        else:
            # The review permission explicitly grants access to saved evidence. It
            # does not grant the underlying tool/resource permissions or execution.
            self._audit(conversation, "review")
        data = dict(self.get_serializer(conversation).data)
        turns = list(conversation.turns.order_by("sequence")[:MAX_TURNS + 1])
        if len(turns) > MAX_TURNS:
            raise ConversationLimit()
        data["turns"] = ConversationTurnSerializer(turns, many=True).data
        return Response(data)

    @transaction.atomic
    def partial_update(self, request, pk=None):
        conversation = self._locked_conversation(pk)
        serializer = ConversationTitleSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "title" in serializer.validated_data:
            conversation.title = serializer.validated_data["title"]
            conversation.save(update_fields=["title", "updated_at"])
        self._audit(conversation, "rename")
        return Response(self.get_serializer(conversation).data)

    @transaction.atomic
    def destroy(self, request, pk=None):
        conversation = self._locked_conversation(pk)
        recover_expired(conversation)
        if conversation.active_request_id:
            raise ConversationConflict("Stop this conversation's active response before deleting its history.")
        self._audit(conversation, "delete")
        conversation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
