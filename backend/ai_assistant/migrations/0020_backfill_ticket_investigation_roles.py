from django.db import migrations


ROLE_TITLES = {
    "reviewer": "Investigation Reviewer · Ready for Report",
    "reporter": "Reporter · Evidence Review",
    "explainer": "Finding Explainer · Report Derivations",
}


def add_runtime_roles(apps, schema_editor):
    Session = apps.get_model("ai_assistant", "TicketInvestigationSession")
    Run = apps.get_model("ai_assistant", "TicketInvestigationRun")
    for session in Session.objects.iterator():
        existing = set(Run.objects.filter(session_id=session.id).values_list("role", flat=True))
        Run.objects.bulk_create([
            Run(session_id=session.id, created_by_id=session.owner_id, role=role, title=title)
            for role, title in ROLE_TITLES.items() if role not in existing
        ])


class Migration(migrations.Migration):
    dependencies = [("ai_assistant", "0019_ticket_investigation_runtime")]

    operations = [migrations.RunPython(add_runtime_roles, migrations.RunPython.noop)]
