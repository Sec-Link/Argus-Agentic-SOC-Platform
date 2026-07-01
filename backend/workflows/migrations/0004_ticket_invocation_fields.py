from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workflows', '0003_workflow_schedule_and_prefect_deployment'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflow',
            name='inputs_schema',
            field=models.JSONField(blank=True, default=list, help_text='Input definitions for ticket-context workflow invocation.'),
        ),
        migrations.AddField(
            model_name='workflow',
            name='is_callable_from_ticket',
            field=models.BooleanField(default=False, help_text='Whether this workflow can be invoked from ticket context.'),
        ),
        migrations.AddField(
            model_name='workflow',
            name='allowed_invoker_roles',
            field=models.JSONField(blank=True, default=list, help_text='Django group names allowed to invoke this workflow from tickets.'),
        ),
    ]
