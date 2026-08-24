from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('alerts', '0013_alter_alert_severity_length'),
    ]

    operations = [
        migrations.AddField(
            model_name='alert',
            name='risk_objects',
            field=models.JSONField(blank=True, default=list, null=True),
        ),
    ]
