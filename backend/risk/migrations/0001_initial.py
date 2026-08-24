from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='RiskRuleConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rule_uuid', models.CharField(db_index=True, max_length=128, unique=True)),
                ('risk_object_fields', models.JSONField(default=list)),
                ('base_score_override', models.IntegerField(default=0)),
                ('enabled', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'risk_rule_config'},
        ),
        migrations.CreateModel(
            name='RiskObjectProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('risk_object', models.CharField(db_index=True, max_length=512)),
                ('risk_object_type', models.CharField(
                    choices=[('ip', 'IP Address'), ('user', 'User'), ('host', 'Host'),
                             ('hash', 'File Hash'), ('domain', 'Domain'), ('other', 'Other')],
                    db_index=True, default='other', max_length=32)),
                ('current_score', models.FloatField(default=0.0)),
                ('peak_score_24h', models.FloatField(default=0.0)),
                ('total_events', models.IntegerField(default=0)),
                ('status', models.CharField(
                    choices=[('active', 'Active'), ('resolved', 'Resolved')],
                    db_index=True, default='active', max_length=16)),
                ('last_seen', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'risk_object_profile',
                'indexes': [
                    models.Index(fields=['-current_score'], name='risk_object__current_score_idx'),
                    models.Index(fields=['status', '-current_score'], name='risk_object__status_score_idx'),
                ],
            },
        ),
        migrations.AlterUniqueTogether(
            name='riskobjectprofile',
            unique_together={('risk_object', 'risk_object_type')},
        ),
        migrations.CreateModel(
            name='RiskEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('profile', models.ForeignKey(db_index=True, on_delete=django.db.models.deletion.CASCADE,
                                              related_name='events', to='risk.riskobjectprofile')),
                ('alert_id', models.CharField(db_index=True, max_length=128)),
                ('rule_uuid', models.CharField(blank=True, db_index=True, default='', max_length=128)),
                ('rule_name', models.CharField(blank=True, default='', max_length=255)),
                ('severity', models.CharField(default='low', max_length=32)),
                ('score_contribution', models.FloatField(default=0.0)),
                ('raw_alert', models.JSONField(default=dict)),
                ('occurred_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'risk_event',
                'indexes': [
                    models.Index(fields=['profile', '-occurred_at'], name='risk_event_profile_ts_idx'),
                    models.Index(fields=['alert_id'], name='risk_event_alert_id_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='RiskScoreEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('profile', models.ForeignKey(db_index=True, on_delete=django.db.models.deletion.CASCADE,
                                              related_name='score_entries', to='risk.riskobjectprofile')),
                ('entry_type', models.CharField(
                    choices=[('alert', 'Alert Contribution'), ('decay', 'Score Decay'), ('manual', 'Manual Adjustment')],
                    default='alert', max_length=16)),
                ('delta', models.FloatField()),
                ('score_after', models.FloatField()),
                ('note', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                'db_table': 'risk_score_entry',
                'indexes': [
                    models.Index(fields=['profile', '-created_at'], name='risk_score_entry_profile_ts_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='NotableEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('profile', models.ForeignKey(db_index=True, on_delete=django.db.models.deletion.CASCADE,
                                              related_name='notable_events', to='risk.riskobjectprofile')),
                ('risk_object', models.CharField(db_index=True, max_length=512)),
                ('risk_object_type', models.CharField(max_length=32)),
                ('score_at_trigger', models.FloatField()),
                ('threshold_used', models.FloatField()),
                ('contributing_event_count', models.IntegerField(default=0)),
                ('status', models.CharField(
                    choices=[('open', 'Open'), ('in_review', 'In Review'), ('resolved', 'Resolved')],
                    db_index=True, default='open', max_length=16)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('resolved_by', models.CharField(blank=True, default='', max_length=150)),
                ('triggered_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'risk_notable_event',
                'indexes': [
                    models.Index(fields=['status', '-triggered_at'], name='risk_notable_status_ts_idx'),
                    models.Index(fields=['risk_object', 'status'], name='risk_notable_obj_status_idx'),
                ],
            },
        ),
    ]
