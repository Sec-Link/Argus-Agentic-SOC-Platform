from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("dashboards", "0006_board"),
    ]

    operations = [
        migrations.DeleteModel(
            name="Board",
        ),
    ]
