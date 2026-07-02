from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='LocalDetectionRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rule_uuid', models.CharField(db_index=True, max_length=128, unique=True)),
                ('name', models.CharField(db_index=True, max_length=255)),
                ('enabled', models.BooleanField(db_index=True, default=False)),
                ('rule_type', models.CharField(db_index=True, default='query', max_length=64)),
                ('severity', models.CharField(db_index=True, default='low', max_length=32)),
                ('risk_score', models.IntegerField(default=50)),
                ('version', models.IntegerField(default=1)),
                ('payload', models.JSONField(default=dict)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('created_by', models.CharField(blank=True, default='', max_length=150)),
                ('updated_by', models.CharField(blank=True, default='', max_length=150)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'detection_rule',
            },
        ),
        migrations.CreateModel(
            name='LocalDetectionRuleVersion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.IntegerField()),
                ('change_type', models.CharField(default='update', max_length=20)),
                ('payload', models.JSONField(default=dict)),
                ('changed_by', models.CharField(blank=True, default='', max_length=150)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('rule', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='versions', to='detections.localdetectionrule')),
            ],
            options={
                'db_table': 'detection_rule_version',
                'unique_together': {('rule', 'version')},
            },
        ),
        migrations.AddIndex(
            model_name='localdetectionruleversion',
            index=models.Index(fields=['rule', '-version'], name='detection_r_rule_id_7f47b6_idx'),
        ),
    ]
