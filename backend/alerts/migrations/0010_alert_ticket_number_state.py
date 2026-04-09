from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("alerts", "0009_alert_sync_schedule_and_history"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="alert",
                    name="ticket_number",
                    field=models.CharField(max_length=64, null=True, blank=True),
                ),
            ],
            database_operations=[],
        ),
    ]
