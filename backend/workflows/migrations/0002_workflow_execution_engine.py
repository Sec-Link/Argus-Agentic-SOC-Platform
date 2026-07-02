from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workflows', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflow',
            name='execution_engine',
            field=models.CharField(
                choices=[('local', 'Local (Django)'), ('prefect', 'Prefect')],
                default='local',
                help_text='Engine that runs this workflow: local (Django) or prefect.',
                max_length=20,
            ),
        ),
    ]
