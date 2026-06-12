import json
from pathlib import Path

from django.db import migrations


def seed_default_mappings(apps, schema_editor):
    mapping_model = apps.get_model("detections", "LocalDetectionFieldMapping")
    source_path = Path(__file__).resolve().parents[1] / "default_mappings.json"
    if not source_path.exists():
        return

    rows = json.loads(source_path.read_text(encoding="utf-8"))
    actor = "migration:0005_seed_default_mappings"
    for row in rows:
        profile = str(row.get("mapping_profile") or row.get("profile") or "").strip()
        if profile == "*":
            profile = "common"
        sigma_field = str(row.get("sigma") or row.get("sigma_field") or "").strip()
        if not profile or not sigma_field:
            continue

        obj, created = mapping_model.objects.update_or_create(
            mapping_profile=profile,
            sigma_field=sigma_field,
            defaults={
                "category": str(row.get("category") or ""),
                "data_source": str(row.get("data_source") or row.get("datasource") or ""),
                "event_category": str(row.get("event_category") or row.get("event") or ""),
                "splunk_field": str(row.get("splunk") or row.get("splunk_field") or ""),
                "elastic_field": str(row.get("elastic") or row.get("elastic_field") or ""),
                "updated_by": actor,
            },
        )
        if created:
            obj.created_by = actor
            obj.save(update_fields=["created_by"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0004_localdetectiondeployment"),
    ]

    operations = [
        migrations.RunPython(seed_default_mappings, noop_reverse),
    ]
