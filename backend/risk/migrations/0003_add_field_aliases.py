from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('risk', '0002_globalriskconfig'),
    ]

    operations = [
        migrations.AddField(
            model_name='globalriskconfig',
            name='field_aliases',
            field=models.JSONField(default=list, blank=True,
                                   help_text='[{"source": "src_ip", "ecs": "source.ip"}, ...]'),
        ),
        migrations.AddField(
            model_name='riskruleconfig',
            name='field_aliases',
            field=models.JSONField(default=list, blank=True,
                                   help_text='Per-rule alias overrides, same format as global.'),
        ),
    ]
