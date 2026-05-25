from django.db import migrations, models
from django.contrib.postgres.indexes import BrinIndex


class Migration(migrations.Migration):

    dependencies = [
        ('alerts', '0013_alter_alert_severity_length'),
    ]

    operations = [
        # Range filter acceleration for dashboard time windows.
        migrations.AddIndex(
            model_name='alert',
            index=BrinIndex(fields=['timestamp'], name='alerts_alert_ts_brin'),
        ),
        # Distinct/source aggregations.
        migrations.AddIndex(
            model_name='alert',
            index=models.Index(fields=['source_index'], name='alerts_alert_src_idx'),
        ),
        # Rule-based counters and grouping.
        migrations.AddIndex(
            model_name='alert',
            index=models.Index(fields=['rule_id'], name='alerts_alert_rule_idx'),
        ),
        # Severity/category trend distributions.
        migrations.AddIndex(
            model_name='alert',
            index=models.Index(fields=['severity'], name='alerts_alert_sev_idx'),
        ),
        migrations.AddIndex(
            model_name='alert',
            index=models.Index(fields=['category'], name='alerts_alert_cat_idx'),
        ),
    ]

