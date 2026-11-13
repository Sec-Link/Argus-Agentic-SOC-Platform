from django.db import migrations, models
from django.utils import timezone


def require_approval(apps, schema_editor):
    # Existing exemptions predate the superuser-only authorization boundary.
    alias = schema_editor.connection.alias
    apps.get_model("ai_assistant", "HttpToolConfig").objects.using(alias).update(
        requires_approval=True, updated_at=timezone.now(),
    )
    apps.get_model("ai_assistant", "ExternalMCPServer").objects.using(alias).update(
        tool_approvals={}, updated_at=timezone.now(),
    )


class Migration(migrations.Migration):
    dependencies = [
        ("ai_assistant", "0018_model_temperature"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.AddField(
            model_name="httptoolconfig", name="use_groups",
            field=models.ManyToManyField(blank=True, related_name="usable_http_tools", to="auth.group"),
        ),
        migrations.AddField(
            model_name="externalmcpserver", name="use_groups",
            field=models.ManyToManyField(blank=True, related_name="usable_mcp_servers", to="auth.group"),
        ),
        migrations.AlterModelOptions(
            name="httptoolconfig",
            options={"permissions": [("manage_access_httptoolconfig", "Can manage HTTP tool use roles")]},
        ),
        migrations.AlterModelOptions(
            name="externalmcpserver",
            options={"permissions": [("manage_access_externalmcpserver", "Can manage MCP server use roles")]},
        ),
        migrations.RunPython(require_approval, migrations.RunPython.noop),
    ]
