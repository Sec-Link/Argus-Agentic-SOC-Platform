import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0005_seed_log_source_categories"),
    ]

    operations = [
        migrations.CreateModel(
            name="LogSourceMapping",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_key", models.CharField(max_length=255, unique=True)),
                ("ignored", models.BooleanField(default=False)),
                ("note", models.CharField(blank=True, default="", max_length=255)),
                ("updated_by", models.CharField(blank=True, default="", max_length=150)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="source_mappings",
                        to="dashboards.logsourcecategory",
                    ),
                ),
            ],
            options={
                "db_table": "dashboards_log_source_mapping",
                "ordering": ["source_key"],
            },
        ),
    ]
