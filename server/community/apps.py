from django.utils.translation import gettext_lazy as _
from django.apps import AppConfig

class CommunityConfig(AppConfig):
    name = "community"
    verbose_name = _("投稿审核")
