from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('workflows', '0002_workflow_execution_engine'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflow',
            name='prefect_deployment_id',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Optional Prefect deployment id override for this workflow.',
                max_length=64,
            ),
        ),
        migrations.CreateModel(
            name='WorkflowSchedule',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(default='default', max_length=200)),
                ('schedule_type', models.CharField(choices=[('cron', 'Cron'), ('interval', 'Interval (seconds)')], default='cron', max_length=20)),
                ('cron', models.CharField(blank=True, max_length=100, null=True)),
                ('interval_seconds', models.PositiveIntegerField(blank=True, null=True)),
                ('timezone', models.CharField(default='UTC', max_length=64)),
                ('is_active', models.BooleanField(default=True)),
                ('trigger_source', models.CharField(default='schedule', max_length=200)),
                ('trigger_data', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workflow_schedules', to='auth.user')),
                ('workflow', models.ForeignKey(help_text='Workflow this schedule belongs to', on_delete=django.db.models.deletion.CASCADE, related_name='schedules', to='workflows.workflow')),
            ],
            options={
                'verbose_name': 'Workflow Schedule',
                'verbose_name_plural': 'Workflow Schedules',
                'ordering': ['-created_at'],
            },
        ),
    ]

