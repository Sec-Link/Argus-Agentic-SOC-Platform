from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('workflows', '0011_workflow_variables')]

    operations = [
        migrations.AddField(
            model_name='workflow',
            name='secret_variables',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='Encrypted reusable workflow variables; plaintext is write-only.',
            ),
        ),
    ]
