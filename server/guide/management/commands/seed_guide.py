import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction
from guide.legacy_catalog import seed_builtin_places
from guide.models import CampusPlace, GuideCategory, GuidePost, Publication

class Command(BaseCommand):
    help = "添加学生指南初始内容，保留管理员已有修改。"

    @transaction.atomic
    def handle(self, *args, **options):
        source = Path(__file__).resolve().parents[2] / "seed.json"
        for order, category in enumerate(json.loads(source.read_text(encoding="utf-8"))):
            group, _ = GuideCategory.objects.get_or_create(key=category["key"], defaults={
                "title": category["title"], "subtitle": category["subtitle"],
                "introduction": category["introduction"], "sort_order": order,
            })
            for position, entry in enumerate(category["entries"]):
                key = entry.pop("key")
                publication, _ = Publication.objects.get_or_create(key=key, defaults={"sort_order": position})
                GuidePost.objects.get_or_create(publication=publication, defaults={**entry, "category": group})
        seed_builtin_places(Publication, CampusPlace)
        self.stdout.write("学生指南初始内容已就绪，已有修改已保留。")
