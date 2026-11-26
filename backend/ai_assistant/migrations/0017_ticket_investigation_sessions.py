# Generated for ticket-scoped AI investigation sessions.

import django.conf
import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ai_assistant", "0016_call_details"),
        ("tickets", "0004_eventticket_labels"),
        migrations.swappable_dependency(django.conf.settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="TicketInvestigationSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("sequence", models.PositiveIntegerField()),
                ("title", models.CharField(default="New investigation", max_length=120)),
                ("model_profile_id", models.UUIDField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=django.conf.settings.AUTH_USER_MODEL)),
                ("ticket", models.ForeignKey(db_column="ticket_number", on_delete=django.db.models.deletion.CASCADE, to="tickets.eventticket")),
            ],
            options={"db_table": "ai_ticket_investigation_sessions", "ordering": ["-updated_at", "-id"]},
        ),
        migrations.CreateModel(
            name="TicketInvestigationRun",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("role", models.CharField(choices=[("main", "Main Agent"), ("planner", "Planner"), ("worker", "Worker"), ("side_question", "Side Question")], max_length=16)),
                ("title", models.CharField(max_length=180)),
                ("objective", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("open", "Open"), ("running", "Running"), ("paused", "Paused"), ("completed", "Completed"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="open", max_length=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=django.conf.settings.AUTH_USER_MODEL)),
                ("parent", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="children", to="ai_assistant.ticketinvestigationrun")),
                ("session", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="runs", to="ai_assistant.ticketinvestigationsession")),
            ],
            options={"db_table": "ai_ticket_investigation_runs", "ordering": ["created_at", "id"]},
        ),
        migrations.CreateModel(
            name="TicketInvestigationMessage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("role", models.CharField(choices=[("user", "User"), ("assistant", "Assistant"), ("system", "System")], max_length=12)),
                ("content", models.TextField()),
                ("trace", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=django.conf.settings.AUTH_USER_MODEL)),
                ("run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="ai_assistant.ticketinvestigationrun")),
                ("session", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="ai_assistant.ticketinvestigationsession")),
            ],
            options={"db_table": "ai_ticket_investigation_messages", "ordering": ["created_at", "id"]},
        ),
        migrations.AddConstraint(model_name="ticketinvestigationsession", constraint=models.UniqueConstraint(fields=("ticket", "owner", "sequence"), name="ai_ticket_inv_session_seq")),
        migrations.AddIndex(model_name="ticketinvestigationsession", index=models.Index(fields=["ticket", "owner", "-updated_at"], name="ai_ticket_inv_owner_idx")),
        migrations.AddIndex(model_name="ticketinvestigationrun", index=models.Index(fields=["session", "role", "created_at"], name="ai_ticket_inv_run_idx")),
        migrations.AddIndex(model_name="ticketinvestigationmessage", index=models.Index(fields=["run", "created_at"], name="ai_ticket_inv_msg_idx")),
    ]
