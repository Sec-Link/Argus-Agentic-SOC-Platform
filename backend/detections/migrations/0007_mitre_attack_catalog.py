from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0006_localdetectionruleversion_change_summary"),
    ]

    operations = [
        migrations.AddField(
            model_name="localdetectionfieldmapping",
            name="elastic_index_patterns",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.CreateModel(
            name="LocalDetectionRuleMitreAttack",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("rule_id", models.CharField(db_index=True, max_length=128)),
                ("kibana_rule_id", models.CharField(blank=True, db_index=True, default="", max_length=128)),
                ("tactic_id", models.CharField(db_index=True, max_length=32)),
                ("tactic_name", models.CharField(max_length=128)),
                ("technique_id", models.CharField(db_index=True, max_length=32)),
                ("technique_name", models.CharField(max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "detection_rule_mitre_attack",
                "unique_together": {("rule_id", "tactic_id", "technique_id")},
            },
        ),
        migrations.CreateModel(
            name="MitreAttackTactic",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tactic_id", models.CharField(db_index=True, max_length=32, unique=True)),
                ("name", models.CharField(max_length=128)),
                ("shortname", models.CharField(db_index=True, max_length=128, unique=True)),
                ("reference_url", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "mitre_attack_tactic",
            },
        ),
        migrations.CreateModel(
            name="MitreAttackTechnique",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("technique_id", models.CharField(db_index=True, max_length=32, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("reference_url", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "mitre_attack_technique",
            },
        ),
        migrations.CreateModel(
            name="MitreAttackTechniqueTactic",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("tactic", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="technique_links", to="detections.mitreattacktactic")),
                ("technique", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="tactic_links", to="detections.mitreattacktechnique")),
            ],
            options={
                "db_table": "mitre_attack_technique_tactic",
                "unique_together": {("technique", "tactic")},
            },
        ),
        migrations.AddIndex(
            model_name="localdetectionrulemitreattack",
            index=models.Index(fields=["rule_id", "tactic_id"], name="detection_r_rule_id_031214_idx"),
        ),
        migrations.AddIndex(
            model_name="localdetectionrulemitreattack",
            index=models.Index(fields=["tactic_id", "technique_id"], name="detection_r_tactic__b92baa_idx"),
        ),
        migrations.AddIndex(
            model_name="mitreattacktechniquetactic",
            index=models.Index(fields=["technique", "tactic"], name="mitre_attac_techniq_b948d4_idx"),
        ),
        migrations.AddIndex(
            model_name="mitreattacktechniquetactic",
            index=models.Index(fields=["tactic", "technique"], name="mitre_attac_tactic__11e9a8_idx"),
        ),
    ]
