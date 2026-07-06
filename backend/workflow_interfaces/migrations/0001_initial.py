import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='InterfaceEndpoint',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('interface_type', models.CharField(choices=[('api', 'API'), ('webhook', 'Webhook')], default='api', max_length=20)),
                ('secret_token', models.CharField(blank=True, default='', max_length=128)),
                ('hmac_secret', models.CharField(blank=True, default='', max_length=128)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('last_event_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='interface_endpoints',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='InterfaceRequestLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('method', models.CharField(max_length=10)),
                ('source_ip', models.GenericIPAddressField(blank=True, null=True)),
                ('response_status', models.PositiveSmallIntegerField(default=200)),
                ('request_body', models.JSONField(blank=True, default=dict)),
                ('response_body', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('endpoint', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='logs',
                    to='workflow_interfaces.interfaceendpoint',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
