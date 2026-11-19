from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ai_assistant", "0012_execution_settings")]

    operations = [
        migrations.AddField(
            model_name="httptoolconfig", name="requires_approval",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="externalmcpserver", name="tool_approvals",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
