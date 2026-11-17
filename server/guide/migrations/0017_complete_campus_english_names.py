from django.db import migrations


ENGLISH_NAMES = {
    "hong-kong-daily": "Hong Kong Daily",
    "sandwich-club": "Kiosk by The Sandwich Club",
    "union-restaurant": "Union Restaurant",
    "starbucks-composite": "Starbucks Coffee (Composite Building)",
    "tai-tai-foodtopia": "TAI TAI FOODTOPIA",
    "vending-nook": "Vending Nook",
    "bijas": "BIJAS Vegetarian",
    "vending-hub": "Vending Hub",
}


def fill_english_names(apps, schema_editor):
    places = apps.get_model("guide", "CampusPlace").objects.using(schema_editor.connection.alias)
    for code, english in ENGLISH_NAMES.items():
        places.filter(pk=code, is_builtin=True).update(name_en=english)


class Migration(migrations.Migration):
    dependencies = [("guide", "0016_campus_display_levels")]
    operations = [migrations.RunPython(fill_english_names, migrations.RunPython.noop)]
