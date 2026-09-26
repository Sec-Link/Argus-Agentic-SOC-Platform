from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0005_auditlog_action_type_auditlog_details_and_more"),
        ("accounts", "0006_rename_workflow_http_allowlist"),
    ]

    operations = []
