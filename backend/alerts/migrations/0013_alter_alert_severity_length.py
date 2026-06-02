from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('alerts', '0012_delete_webhookconfig'),
    ]

    operations = [
        migrations.AlterField(
            model_name='alert',
            name='severity',
            field=models.CharField(max_length=64, null=True, blank=True),
        ),
    ]
