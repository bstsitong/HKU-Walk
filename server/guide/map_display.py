from django.utils.translation import gettext_lazy as _
import json
from pathlib import Path

DISPLAY_LEVELS = [(1, _("一级 · 入口")), (2, _("二级 · 楼宇和广场")),
                  (3, _("三级 · 景点、餐饮和商店")), (4, _("四级 · 设施"))]
_DATA_DIR = Path(__file__).parent
_RULES = json.loads((_DATA_DIR / "map_display.json").read_text(encoding="utf-8"))
PLACE_ALIASES = _RULES["aliases"]


def canonical_place_id(code):
    return PLACE_ALIASES.get(code, code)


def place_display_level(category, code=None, *, classroom=False):
    if classroom:
        return 4
    return _RULES["places"].get(code, _RULES["categories"].get(category, 4))


def seed_map_facilities(Facility, using="default"):
    facilities = json.loads((_DATA_DIR / "campus_facilities.json").read_text(encoding="utf-8"))
    for item in facilities:
        if item["kind"] == "gate":
            continue
        x, y = item["at"]
        Facility.objects.using(using).get_or_create(code=item["id"], defaults={
            "kind": item["kind"], "map_x": x, "map_y": y, "title": item["title"], "name_en": item["english"],
            "detail": item["detail"], "display_level": item["displayLevel"],
            "overview": item.get("overview", False), "approximate": item.get("approximate", False),
        })
