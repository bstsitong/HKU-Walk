from django.utils.translation import gettext_lazy as _
from django.apps import AppConfig

class GuideConfig(AppConfig):
    name = "guide"
    verbose_name = _("已发布内容")

    def ready(self):
        from config.database import register
        register()
