from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0007_field_mapping_elastic_index_patterns"),
    ]

    operations = [
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
            model_name="mitreattacktechniquetactic",
            index=models.Index(fields=["technique", "tactic"], name="mitre_attac_techniq_b85d1d_idx"),
        ),
        migrations.AddIndex(
            model_name="mitreattacktechniquetactic",
            index=models.Index(fields=["tactic", "technique"], name="mitre_attac_tactic__77b941_idx"),
        ),
    ]
