from django.apps import AppConfig

class GuideConfig(AppConfig):
    name = "guide"
    verbose_name = "已发布内容"

    def ready(self):
        from config.database import register
        register()
