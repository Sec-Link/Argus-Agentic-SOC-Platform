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
    ]
