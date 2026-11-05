from django.db import migrations

# Categories are seeded without index matchers: patterns are environment-specific, so each
# category shows as "not configured" until an admin sets its matchers.
DEFAULT_CATEGORIES = ["Endpoint", "EDR", "Firewall", "Identity", "Cloud", "DNS", "Email"]


def seed(apps, schema_editor):
    LogSourceCategory = apps.get_model("dashboards", "LogSourceCategory")
    for order, name in enumerate(DEFAULT_CATEGORIES):
        LogSourceCategory.objects.get_or_create(name=name, defaults={"sort_order": order})


def unseed(apps, schema_editor):
    LogSourceCategory = apps.get_model("dashboards", "LogSourceCategory")
    LogSourceCategory.objects.filter(name__in=DEFAULT_CATEGORIES, matchers=[]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0004_logsourcecategory"),
    ]

    operations = [migrations.RunPython(seed, unseed)]
