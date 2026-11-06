"""Conversion from the original shared publication payload."""
import json
from pathlib import Path


def builtin_places():
    return json.loads(Path(__file__).with_name("base_places_v1.json").read_text(encoding="utf-8"))


def builtin_fields(data):
    return {
        "name_zh": data["name"], "name_en": data["english"],
        "abbreviation_en": data["abbreviation"], "keywords": data["keywords"],
        "category": data["category"], "map_x": data["x"], "map_y": data["y"],
        "body": "", "is_builtin": True,
    }


def place_fields(data):
    return {
        "name_en": data.get("english", ""), "abbreviation_en": data.get("abbreviation", ""),
        "category": data["category"], "map_x": data["x"], "map_y": data["y"],
        "entrance": data.get("entrance", ""), "floor": data.get("floor", ""),
    }


def seed_builtin_places(Publication, CampusPlace, using="default", legacy_defaults=None):
    publications = Publication.objects.using(using)
    places = CampusPlace.objects.using(using)
    for order, data in enumerate(builtin_places()):
        if places.filter(pk=data["id"]).exists():
            continue
        publication, _ = publications.get_or_create(
            key=f"builtin-{data['id']}", defaults={"kind": "place", "sort_order": order, **(legacy_defaults or {})},
        )
        places.get_or_create(code=data["id"], defaults={"publication": publication, **builtin_fields(data)})
