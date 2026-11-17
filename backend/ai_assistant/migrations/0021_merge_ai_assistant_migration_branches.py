from django.db import migrations


class Migration(migrations.Migration):
    """Join the model-profile and ticket-investigation migration branches."""

    dependencies = [
        ("ai_assistant", "0019_external_tool_use_roles"),
        ("ai_assistant", "0020_backfill_ticket_investigation_roles"),
    ]

    operations = []
