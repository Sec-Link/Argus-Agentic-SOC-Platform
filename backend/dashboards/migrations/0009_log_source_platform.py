from django.db import migrations, models


def seed_splunk(apps, schema_editor):
    category = apps.get_model("dashboards", "LogSourceCategory")
    for order, name in enumerate(["Endpoint", "EDR", "Firewall", "Identity", "Cloud", "DNS", "Email"]):
        category.objects.using(schema_editor.connection.alias).get_or_create(
            platform="splunk", name=name, defaults={"sort_order": order, "host_field": "host"},
        )


class Migration(migrations.Migration):
    dependencies = [("dashboards", "0008_logsourcecategory_icon")]
    operations = [
        migrations.AddField(model_name=name, name="platform", field=models.CharField(
            choices=[("elk", "ELK"), ("splunk", "Splunk")], default="elk", max_length=10,
            **({"db_index": True} if name == "logsourcescan" else {}),
        )) for name in ("logsourcecategory", "logsourcemapping", "logsourcescan")
    ] + [
        migrations.AddField(model_name="logsourcescan", name="targets", field=models.JSONField(default=dict, blank=True)),
        migrations.AlterField(model_name="logsourcecategory", name="name", field=models.CharField(max_length=100)),
        migrations.AlterField(model_name="logsourcemapping", name="source_key", field=models.CharField(max_length=255)),
        migrations.AddConstraint(model_name="logsourcecategory", constraint=models.UniqueConstraint(
            fields=("platform", "name"), name="log_category_platform_name")),
        migrations.AddConstraint(model_name="logsourcemapping", constraint=models.UniqueConstraint(
            fields=("platform", "source_key"), name="log_mapping_platform_source")),
        # Removing platform isolation cannot safely merge independently configured categories.
        migrations.RunPython(seed_splunk),
    ]
