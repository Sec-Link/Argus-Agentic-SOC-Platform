from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0003_field_mapping"),
    ]

    operations = [
        migrations.CreateModel(
            name="LocalDetectionDeployment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("deployment_uuid", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("rule_name", models.CharField(blank=True, default="", max_length=255)),
                ("target", models.CharField(db_index=True, max_length=64)),
                ("action", models.CharField(db_index=True, max_length=64)),
                ("status", models.CharField(db_index=True, max_length=32)),
                ("remote_id", models.CharField(blank=True, default="", max_length=128)),
                ("remote_rule_id", models.CharField(blank=True, default="", max_length=128)),
                ("message", models.TextField(blank=True, default="")),
                ("payload", models.JSONField(default=dict)),
                ("created_by", models.CharField(blank=True, default="", max_length=150)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="deployments",
                        to="detections.localdetectionrule",
                    ),
                ),
            ],
            options={"db_table": "detection_deployment"},
        ),
        migrations.AddIndex(
            model_name="localdetectiondeployment",
            index=models.Index(fields=["rule", "-created_at"], name="detection_d_rule_id_f2afc7_idx"),
        ),
        migrations.AddIndex(
            model_name="localdetectiondeployment",
            index=models.Index(fields=["target", "status"], name="detection_d_target_c1707f_idx"),
        ),
    ]
