import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ai_assistant", "0021_merge_ai_assistant_migration_branches"),
    ]

    operations = [
        migrations.AlterField(
            model_name="modelprofile",
            name="temperature",
            field=models.FloatField(
                blank=True,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(0),
                    django.core.validators.MaxValueValidator(2),
                ],
            ),
        ),
    ]
