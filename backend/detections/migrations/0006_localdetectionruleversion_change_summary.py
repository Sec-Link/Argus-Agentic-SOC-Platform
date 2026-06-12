from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0005_seed_default_mappings"),
    ]

    operations = [
        migrations.AddField(
            model_name="localdetectionruleversion",
            name="change_summary",
            field=models.JSONField(default=list),
        ),
    ]
