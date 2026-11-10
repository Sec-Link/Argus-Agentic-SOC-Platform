from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0003_delete_dashboard"),
    ]

    operations = [
        migrations.CreateModel(
            name="LogSourceCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("matchers", models.JSONField(blank=True, default=list)),
                ("asset_types", models.JSONField(blank=True, default=list)),
                ("host_field", models.CharField(blank=True, default="host.name", max_length=128)),
                ("enabled", models.BooleanField(default=True)),
                ("sort_order", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "dashboards_log_source_category",
                "ordering": ["sort_order", "name"],
            },
        ),
    ]
