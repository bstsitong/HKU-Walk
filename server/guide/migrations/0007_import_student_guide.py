from django.db import migrations

from guide.seed_content import seed_posts


def import_guide(apps, schema_editor):
    categories = apps.get_model("guide", "GuideCategory")
    using = schema_editor.connection.alias
    if categories.objects.using(using).exists():
        seed_posts(categories, apps.get_model("guide", "GuidePost"),
                   apps.get_model("guide", "Publication"), using, refresh_defaults=True)


class Migration(migrations.Migration):
    dependencies = [("guide", "0006_refresh_campus_map")]
    operations = [migrations.RunPython(import_guide, migrations.RunPython.noop)]
