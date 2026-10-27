import uuid
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from tickets.models import EventTicket


class ExternalMCPServer(models.Model):
    name = models.CharField(max_length=120, unique=True)
    endpoint = models.URLField(max_length=500)
    title = models.CharField(max_length=200, blank=True)
    token = models.TextField(blank=True)
    enabled = models.BooleanField(default=True)
    extra = models.JSONField(default=dict, blank=True)
    tool_approvals = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_external_mcp_servers"

    def __str__(self) -> str:
        return f"{self.name} ({self.endpoint})"


class HttpToolConfig(models.Model):
    name = models.CharField(
        max_length=48, unique=True,
        validators=[RegexValidator(r"^[a-z][a-z0-9_]{0,47}$", "Use lowercase letters, numbers and underscores, starting with a letter.")],
    )
    description = models.TextField(max_length=1000)
    enabled = models.BooleanField(default=False)
    requires_approval = models.BooleanField(default=True)
    method = models.CharField(max_length=4, choices=[("GET", "GET"), ("POST", "POST")], default="GET")
    url = models.CharField(max_length=2000)
    parameters = models.JSONField(default=list, blank=True)
    query_params = models.JSONField(default=dict, blank=True)
    body_template = models.JSONField(null=True, blank=True, default=None)
    auth_type = models.CharField(
        max_length=8, choices=[("none", "None"), ("bearer", "Bearer"), ("header", "Header")], default="none",
    )
    auth_header = models.CharField(max_length=100, blank=True, default="")
    auth_prefix = models.CharField(max_length=40, blank=True, default="")
    encrypted_auth_secret = models.TextField(blank=True, default="")
    timeout_seconds = models.PositiveSmallIntegerField(
        default=15, validators=[MinValueValidator(1), MaxValueValidator(30)],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_http_tool_configs"

    def __str__(self) -> str:
        return self.name

    def as_tool_config(self) -> dict:
        """Snapshot for runtime validation and approval; excludes credentials."""
        fields = (
            "name", "description", "enabled", "method", "url", "parameters", "query_params",
            "body_template", "auth_type", "auth_header", "auth_prefix", "timeout_seconds", "requires_approval",
        )
        return {
            **{field: getattr(self, field) for field in fields},
            "id": self.pk, "version": self.updated_at.isoformat() if self.updated_at else None,
        }


class AgentConfig(models.Model):
    name = models.CharField(
        max_length=48, unique=True,
        validators=[RegexValidator(r"^[a-z][a-z0-9_]{0,47}$", "Use lowercase letters, numbers and underscores, starting with a letter.")],
    )
    title = models.CharField(max_length=120)
    role = models.CharField(max_length=500)
    instructions = models.TextField(max_length=6000)
    enabled = models.BooleanField(default=False)
    max_iterations = models.PositiveSmallIntegerField(
        default=3, validators=[MinValueValidator(1), MaxValueValidator(100)],
    )
    max_delegations = models.PositiveSmallIntegerField(
        default=3, validators=[MinValueValidator(1), MaxValueValidator(100)],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_agent_configs"

    def __str__(self) -> str:
        return self.name


class SkillConfig(models.Model):
    name = models.CharField(max_length=200, unique=True)
    version = models.CharField(max_length=50, default="v1")
    route = models.CharField(max_length=200, blank=True)
    enabled = models.BooleanField(default=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_skill_configs"

    def __str__(self) -> str:
        return self.name


class KnowledgeBaseItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.CharField(max_length=200, db_index=True)
    title = models.CharField(max_length=300)
    file_path = models.CharField(max_length=600, unique=True)
    content = models.TextField()
    content_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_knowledge_base_items"
        indexes = [
            models.Index(fields=["category"], name="ai_kb_category_idx"),
        ]


class KnowledgeEmbedding(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(KnowledgeBaseItem, on_delete=models.CASCADE, related_name="embeddings")
    chunk_index = models.IntegerField()
    chunk_text = models.TextField()
    embedding = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_knowledge_embeddings"
        indexes = [
            models.Index(fields=["item"], name="ai_kb_item_idx"),
        ]


class KnowledgeRetrievalLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation_id = models.CharField(max_length=128, blank=True)
    message_id = models.CharField(max_length=128, blank=True)
    query = models.TextField()
    risk_type = models.CharField(max_length=200, blank=True)
    retrieved_item_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_knowledge_retrieval_logs"


class MCPToolExecution(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tool_name = models.CharField(max_length=200, db_index=True)
    arguments = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=32, db_index=True)
    error = models.TextField(blank=True)
    start_time = models.DateTimeField(auto_now_add=True)
    end_time = models.DateTimeField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    endpoint = models.CharField(max_length=500, blank=True)
    source = models.CharField(max_length=32, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    actor_label = models.CharField(max_length=150, blank=True)
    request_id = models.UUIDField(null=True, blank=True)
    conversation = models.ForeignKey("PageChatConversation", on_delete=models.SET_NULL, null=True, blank=True)
    model_profile = models.ForeignKey("ModelProfile", on_delete=models.SET_NULL, null=True, blank=True)
    model_name = models.CharField(max_length=200, blank=True)
    agent_name = models.CharField(max_length=120, blank=True)
    tool_source = models.CharField(max_length=32, blank=True)
    request_detail = models.JSONField(null=True, blank=True)
    response_detail = models.JSONField(null=True, blank=True)
    detail_permissions = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "ai_mcp_tool_executions"
        indexes = [
            models.Index(fields=["tool_name"], name="ai_mcp_tool_idx"),
            models.Index(fields=["status"], name="ai_mcp_status_idx"),
            models.Index(fields=["start_time"], name="ai_tool_time_idx"),
            models.Index(fields=["actor", "-start_time"], name="ai_tool_actor_time_idx"),
        ]


class MCPToolStats(models.Model):
    tool_name = models.CharField(max_length=200, unique=True)
    total_calls = models.IntegerField(default=0)
    success_calls = models.IntegerField(default=0)
    failed_calls = models.IntegerField(default=0)
    last_call_time = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_mcp_tool_stats"


class SkillStats(models.Model):
    skill_name = models.CharField(max_length=200, unique=True)
    total_calls = models.IntegerField(default=0)
    success_calls = models.IntegerField(default=0)
    failed_calls = models.IntegerField(default=0)
    last_call_time = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_skill_stats"


class TicketAIChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(EventTicket, on_delete=models.CASCADE, to_field="ticket_number", db_column="ticket_number")
    created_by = models.ForeignKey("auth.User", on_delete=models.SET_NULL, null=True, blank=True)
    role = models.CharField(max_length=32)
    content = models.TextField()
    trace = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_ticket_chat_messages"
        indexes = [
            models.Index(fields=["ticket"], name="ai_ticket_chat_idx"),
            models.Index(fields=["created_at"], name="ai_ticket_chat_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.ticket_id} {self.role} @ {self.created_at}"


class PageChatConversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    title = models.CharField(max_length=120, default="New conversation")
    revision = models.PositiveIntegerField(default=0)
    active_request_id = models.UUIDField(null=True, blank=True)
    active_until = models.DateTimeField(null=True, blank=True)
    stored_bytes = models.PositiveIntegerField(default=0)
    required_permissions = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_page_chat_conversations"
        permissions = [("review_all_pagechatconversation", "Can review all users AI conversation history")]
        indexes = [models.Index(fields=["owner", "-updated_at"], name="ai_page_chat_owner_idx")]


class PageChatTurn(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(PageChatConversation, on_delete=models.CASCADE, related_name="turns")
    sequence = models.PositiveIntegerField()
    request_id = models.UUIDField(unique=True)
    message = models.TextField()
    page_context = models.JSONField(null=True, blank=True)
    agent_names = models.JSONField(default=list, blank=True)
    context_options = models.JSONField(default=dict, blank=True)
    model_snapshot = models.JSONField(default=dict, blank=True)
    events = models.JSONField(default=list, blank=True)
    response = models.TextField(blank=True)
    status = models.CharField(max_length=10, default="running", choices=[
        ("running", "Running"), ("done", "Done"), ("error", "Error"), ("stopped", "Stopped"),
    ])
    stored_bytes = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_page_chat_turns"
        ordering = ["sequence"]
        constraints = [models.UniqueConstraint(fields=["conversation", "sequence"], name="ai_page_chat_turn_sequence")]


class ExecutionSettings(models.Model):
    """One server-managed policy for new floating-assistant executions."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    execution_timeout_seconds = models.PositiveSmallIntegerField(
        default=300, validators=[MinValueValidator(30), MaxValueValidator(7200)],
    )
    approval_timeout_seconds = models.PositiveSmallIntegerField(
        default=90, validators=[MinValueValidator(10), MaxValueValidator(1800)],
    )
    max_iterations = models.PositiveSmallIntegerField(
        default=6, validators=[MinValueValidator(1), MaxValueValidator(1000)],
    )
    coordinator_max_iterations = models.PositiveSmallIntegerField(
        default=101, validators=[MinValueValidator(2), MaxValueValidator(1001)],
    )
    max_delegations = models.PositiveSmallIntegerField(
        default=100, validators=[MinValueValidator(1), MaxValueValidator(1000)],
    )

    class Meta:
        db_table = "ai_execution_settings"
        default_permissions = ("view", "change")
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="ai_execution_settings_singleton"),
            models.CheckConstraint(
                condition=models.Q(
                    execution_timeout_seconds__gte=30, execution_timeout_seconds__lte=7200,
                    approval_timeout_seconds__gte=10, approval_timeout_seconds__lte=1800,
                    max_iterations__gte=1, max_iterations__lte=1000,
                    coordinator_max_iterations__gte=2, coordinator_max_iterations__lte=1001,
                    max_delegations__gte=1, max_delegations__lte=1000,
                ),
                name="ai_execution_settings_bounds",
            ),
            models.CheckConstraint(
                condition=models.Q(approval_timeout_seconds__lte=models.F("execution_timeout_seconds")),
                name="ai_execution_approval_deadline",
            ),
        ]


class ModelProfile(models.Model):
    """Server-managed OpenAI-compatible model connection; credentials stay encrypted."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    model = models.CharField(max_length=200)
    base_url = models.CharField(max_length=2000)
    timeout_seconds = models.PositiveSmallIntegerField(
        default=45, validators=[MinValueValidator(1), MaxValueValidator(120)],
    )
    enabled = models.BooleanField(default=False)
    encrypted_api_key = models.TextField(blank=True, default="")
    input_price_per_million = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True,
                                                 validators=[MinValueValidator(0)])
    output_price_per_million = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True,
                                                  validators=[MinValueValidator(0)])
    cached_input_price_per_million = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True,
                                                        validators=[MinValueValidator(0)])
    currency = models.CharField(max_length=3, default="USD", validators=[RegexValidator(r"^[A-Z]{3}$")])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_model_profiles"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(timeout_seconds__gte=1, timeout_seconds__lte=120),
                name="ai_model_profile_timeout_bounds",
            ),
            models.CheckConstraint(
                condition=models.Q(enabled=False) | ~models.Q(encrypted_api_key=""),
                name="ai_model_profile_enabled_key",
            ),
            models.CheckConstraint(
                condition=(models.Q(input_price_per_million__isnull=True) | models.Q(input_price_per_million__gte=0))
                & (models.Q(output_price_per_million__isnull=True) | models.Q(output_price_per_million__gte=0))
                & (models.Q(cached_input_price_per_million__isnull=True) | models.Q(cached_input_price_per_million__gte=0)),
                name="ai_model_profile_price_bounds",
            ),
        ]

    def __str__(self):
        return self.name


class ModelUsage(models.Model):
    """One provider attempt with bounded public diagnostics; credentials stay excluded."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    actor_label = models.CharField(max_length=150, blank=True)
    request_id = models.UUIDField(null=True, blank=True)
    conversation = models.ForeignKey(PageChatConversation, on_delete=models.SET_NULL, null=True, blank=True)
    model_profile = models.ForeignKey(ModelProfile, on_delete=models.SET_NULL, null=True, blank=True)
    profile_name = models.CharField(max_length=120, blank=True)
    model_name = models.CharField(max_length=200, blank=True)
    agent_name = models.CharField(max_length=120, blank=True)
    source = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=10, default="running", choices=[
        ("running", "Running"), ("success", "Success"), ("failed", "Failed"),
    ])
    start_time = models.DateTimeField(auto_now_add=True)
    end_time = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    input_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    output_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    cached_input_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    total_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    input_price_per_million = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    output_price_per_million = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    cached_input_price_per_million = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    currency = models.CharField(max_length=3, default="USD")
    estimated_cost = models.DecimalField(max_digits=24, decimal_places=12, null=True, blank=True)
    error_code = models.CharField(max_length=64, blank=True)
    request_detail = models.JSONField(null=True, blank=True)
    response_detail = models.JSONField(null=True, blank=True)
    detail_permissions = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "ai_model_usage"
        default_permissions = ("view",)
        permissions = [("review_all_modelusage", "Can review all users AI usage")]
        indexes = [
            models.Index(fields=["start_time"], name="ai_usage_time_idx"),
            models.Index(fields=["actor", "-start_time"], name="ai_usage_actor_time_idx"),
            models.Index(fields=["model_profile", "-start_time"], name="ai_usage_model_time_idx"),
        ]
