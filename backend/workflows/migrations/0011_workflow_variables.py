from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('workflows', '0010_workflow_worker_credential')]

    operations = [
        migrations.AddField(
            model_name='workflow',
            name='variables',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='Declared variables available as {{variables.name}} during execution.',
            ),
        ),
    ]
