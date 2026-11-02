import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ai_assistant", "0017_ticket_investigation_sessions"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="TicketInvestigationSideConversation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("model_profile_id", models.UUIDField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ("parent_run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="side_conversations", to="ai_assistant.ticketinvestigationrun")),
                ("session", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="side_conversations", to="ai_assistant.ticketinvestigationsession")),
            ],
            options={"db_table": "ai_ticket_investigation_side_conversations"},
        ),
        migrations.CreateModel(
            name="TicketInvestigationSideMessage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("role", models.CharField(choices=[("user", "User"), ("assistant", "Assistant"), ("system", "System")], max_length=12)),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="completed", max_length=12)),
                ("content", models.TextField()),
                ("context_snapshot", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("conversation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="ai_assistant.ticketinvestigationsideconversation")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "ai_ticket_investigation_side_messages", "ordering": ["created_at", "id"]},
        ),
        migrations.AddConstraint(
            model_name="ticketinvestigationsideconversation",
            constraint=models.UniqueConstraint(fields=("session", "parent_run", "owner"), name="ai_ticket_inv_side_unique"),
        ),
        migrations.AddIndex(
            model_name="ticketinvestigationsideconversation",
            index=models.Index(fields=["session", "parent_run", "owner"], name="ai_ticket_inv_side_idx"),
        ),
        migrations.AddIndex(
            model_name="ticketinvestigationsidemessage",
            index=models.Index(fields=["conversation", "created_at"], name="ai_ticket_inv_side_msg_idx"),
        ),
    ]
