from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0002_add_time_fields"),
    ]

    operations = [
        migrations.DeleteModel(
            name="Dashboard",
        ),
    ]
