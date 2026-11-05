from django.apps import AppConfig

class GuideConfig(AppConfig):
    name = "guide"
    verbose_name = "学生指南"

    def ready(self):
        from config.database import register
        register()
