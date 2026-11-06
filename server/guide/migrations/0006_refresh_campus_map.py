from django.db import migrations, models

from guide.campus_map import seed_current_places


def update_catalog(apps, schema_editor):
    place = apps.get_model("guide", "CampusPlace")
    using = schema_editor.connection.alias
    if place.objects.using(using).filter(is_builtin=True).exists():
        seed_current_places(apps.get_model("guide", "Publication"), place, using)


class Migration(migrations.Migration):
    dependencies = [("guide", "0005_split_publication_content")]
    operations = [
        migrations.AddField(
            model_name="campusplace", name="map_version",
            field=models.PositiveSmallIntegerField("底图版本", choices=[(1, "旧版示意图"), (2, "校园地图")], default=1),
        ),
        migrations.RunPython(update_catalog, migrations.RunPython.noop),
    ]
