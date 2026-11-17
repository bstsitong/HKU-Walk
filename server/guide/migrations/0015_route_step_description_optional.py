from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("guide", "0014_sync_preview_points")]
    operations = [
        migrations.AlterField(
            model_name="routestep",
            name="body",
            field=models.TextField("步骤说明", max_length=1500, blank=True),
        ),
    ]
