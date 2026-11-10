from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0007_logsourcescan"),
    ]

    operations = [
        migrations.AddField(
            model_name="logsourcecategory",
            name="icon_png",
            field=models.BinaryField(blank=True, editable=False, null=True),
        ),
    ]
