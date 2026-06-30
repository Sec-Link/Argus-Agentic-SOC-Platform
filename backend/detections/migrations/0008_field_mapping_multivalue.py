from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0007_mitre_attack_catalog"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql='ALTER TABLE "detection_field_mapping" ADD COLUMN IF NOT EXISTS "elastic_is_multivalue" boolean NOT NULL DEFAULT false',
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="localdetectionfieldmapping",
                    name="elastic_is_multivalue",
                    field=models.BooleanField(default=False),
                ),
            ],
        ),
    ]