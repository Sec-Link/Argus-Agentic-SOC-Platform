"""Manual migration: add TaskRequestLog model

Note: Normally created by `makemigrations`. This manual migration mirrors the model added.
"""
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('orchestrator', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='TaskRequestLog',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ('user', models.CharField(max_length=200, null=True, blank=True)),
                ('logged_at', models.DateTimeField(auto_now_add=True)),
                ('request_body', models.JSONField(default=dict)),
                ('task', models.ForeignKey(null=True, blank=True, to='orchestrator.task', on_delete=models.SET_NULL)),
            ],
        ),
    ]
