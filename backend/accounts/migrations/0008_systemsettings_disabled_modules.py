from django.db import migrations, models


class Migration(migrations.Migration):
    # Additive and reversible: adds one JSON column to the single-row system
    # settings table. Older code ignores the column, so it is safe to apply
    # before or after the application rollout.
    dependencies = [
        ("accounts", "0007_merge_accounts_branches"),
    ]

    operations = [
        migrations.AddField(
            model_name="systemsettings",
            name="disabled_modules",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
