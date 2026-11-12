from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("guide", "0011_author_removal")]

    operations = [
        migrations.AddField(
            model_name="campusplace",
            name="has_power_outlets",
            field=models.BooleanField("有可用插座", null=True, blank=True, default=None),
        ),
        migrations.AddField(
            model_name="campusplace",
            name="power_outlet_location",
            field=models.CharField("插座位置", blank=True, max_length=300, db_default=""),
        ),
        migrations.CreateModel(
            name="AssistantUsage",
            fields=[
                ("day", models.DateField(primary_key=True, serialize=False)),
                ("requests", models.PositiveIntegerField(default=0)),
            ],
        ),
    ]
