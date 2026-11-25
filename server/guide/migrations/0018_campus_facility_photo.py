from django.core.validators import URLValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("guide", "0017_complete_campus_english_names")]
    operations = [migrations.AddField(
        model_name="campusfacility",
        name="image_url",
        field=models.URLField("设施照片链接", blank=True, db_default="", max_length=1000,
                              validators=[URLValidator(schemes=["http", "https"])]),
    )]
