from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('detections', '0002_rename_detection_r_rule_id_7f47b6_idx_detection_r_rule_id_497afd_idx'),
    ]
    operations = [
        migrations.CreateModel(
            name='LocalDetectionFieldMapping',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('category', models.CharField(blank=True, default='', max_length=64)),
                ('data_source', models.CharField(blank=True, default='', max_length=128)),
                ('event_category', models.CharField(blank=True, default='', max_length=128)),
                ('mapping_profile', models.CharField(db_index=True, max_length=128)),
                ('sigma_field', models.CharField(max_length=255)),
                ('splunk_field', models.CharField(blank=True, default='', max_length=255)),
                ('elastic_field', models.CharField(blank=True, default='', max_length=255)),
                ('created_by', models.CharField(blank=True, default='', max_length=150)),
                ('updated_by', models.CharField(blank=True, default='', max_length=150)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'detection_field_mapping',
                'unique_together': {('mapping_profile', 'sigma_field')},
            },
        ),
    ]
