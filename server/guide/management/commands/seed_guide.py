from django.core.management.base import BaseCommand
from django.db import transaction
from guide.articles import seed_articles
from guide.campus_map import seed_current_places
from guide.map_display import seed_map_facilities
from guide.models import CampusFacility, CampusPlace, GuideCategory, GuidePost, Publication
from guide.seed_content import seed_posts

class Command(BaseCommand):
    help = "添加学生指南初始内容，保留管理员已有修改。"

    @transaction.atomic
    def handle(self, *args, **options):
        seed_posts(GuideCategory, GuidePost, Publication)
        seed_articles(GuideCategory, GuidePost, Publication)
        seed_current_places(Publication, CampusPlace)
        seed_map_facilities(CampusFacility)
        self.stdout.write("学生指南初始内容已就绪，已有修改已保留。")
