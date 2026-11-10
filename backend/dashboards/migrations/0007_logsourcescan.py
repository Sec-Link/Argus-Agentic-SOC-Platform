from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0006_logsourcemapping"),
    ]

    operations = [
        migrations.CreateModel(
            name="LogSourceScan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scanned_at", models.DateTimeField()),
                ("window_days", models.IntegerField(default=7)),
                ("truncated", models.BooleanField(default=False)),
                ("payload", models.JSONField(default=list)),
                ("scanned_by", models.CharField(blank=True, default="", max_length=150)),
            ],
            options={
                "db_table": "dashboards_log_source_scan",
                "ordering": ["-scanned_at"],
            },
        ),
    ]
