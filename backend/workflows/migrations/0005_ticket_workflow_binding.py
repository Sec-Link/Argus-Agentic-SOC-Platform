from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('workflows', '0004_ticket_invocation_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='TicketWorkflowBinding',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200)),
                ('label_filters', models.JSONField(blank=True, default=list)),
                ('label_filter_logic', models.CharField(choices=[('AND', 'All labels must match'), ('OR', 'Any label may match')], default='AND', max_length=3)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ticket_workflow_bindings', to=settings.AUTH_USER_MODEL)),
                ('workflow', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ticket_workflow_bindings', to='workflows.workflow')),
            ],
            options={
                'verbose_name': 'Ticket Workflow Binding',
                'verbose_name_plural': 'Ticket Workflow Bindings',
                'ordering': ['-updated_at'],
            },
        ),
    ]
