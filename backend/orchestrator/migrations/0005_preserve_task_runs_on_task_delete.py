import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orchestrator', '0004_task_name_unique'),
    ]

    operations = [
        migrations.AlterField(
            model_name='taskrun',
            name='task',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='runs',
                to='orchestrator.task',
            ),
        ),
    ]
