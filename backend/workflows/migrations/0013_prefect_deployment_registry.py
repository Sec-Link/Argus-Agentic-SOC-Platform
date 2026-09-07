from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [('workflows', '0012_workflow_secret_variables')]

    operations = [
        migrations.CreateModel(
            name='PrefectDeployment',
            fields=[
                ('id', models.UUIDField(primary_key=True, editable=False, serialize=False)),
                ('name', models.CharField(max_length=255)),
                ('work_pool_name', models.CharField(max_length=255, blank=True, default='')),
                ('work_queue_name', models.CharField(max_length=255, blank=True, default='')),
                ('status', models.CharField(max_length=32, blank=True, default='')),
                ('is_available', models.BooleanField(default=True)),
                ('last_synced_at', models.DateTimeField(default=django.utils.timezone.now)),
            ],
            options={'ordering': ['name', 'id']},
        ),
        migrations.AlterField(
            model_name='workflow',
            name='prefect_deployment_id',
            field=models.CharField(
                max_length=64, blank=True, default='',
                help_text='Registered Prefect deployment selected for this workflow. Required before execution.',
            ),
        ),
    ]
