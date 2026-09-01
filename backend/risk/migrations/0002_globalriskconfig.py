from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('risk', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='GlobalRiskConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('risk_object_fields', models.JSONField(default=list)),
                ('updated_by', models.CharField(blank=True, default='', max_length=150)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'risk_global_config'},
        ),
    ]
