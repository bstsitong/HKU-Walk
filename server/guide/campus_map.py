"""Load the campus catalog while keeping published place identities stable."""
import json
from functools import cache
from pathlib import Path

from .legacy_catalog import builtin_fields, builtin_places
from .map_display import place_display_level


MAP_VERSION = 2
LEGACY_PLACES = {place["id"]: place for place in builtin_places()}
DATA_DIR = Path(__file__).parent


@cache
def classroom_records():
    return json.loads((DATA_DIR / "classrooms.json").read_text(encoding="utf-8"))


CLASSROOM_PARENTS = {room["id"]: room["parentBuildingId"] for room in classroom_records()}


@cache
def current_places():
    buildings = json.loads((DATA_DIR / "base_places_v2.json").read_text(encoding="utf-8"))
    buildings_by_id = {place["id"]: place for place in buildings}
    return [
        *buildings,
        *json.loads((DATA_DIR / "additional_map_places.json").read_text(encoding="utf-8")),
        *json.loads((DATA_DIR / "campus_landmarks.json").read_text(encoding="utf-8")),
        *({**room, "category": "building", "x": building["x"], "y": building["y"]}
          for room in classroom_records() for building in (buildings_by_id[room["parentBuildingId"]],)),
    ]


def seed_current_places(Publication, CampusPlace, using="default"):
    publications = Publication.objects.using(using)
    places = CampusPlace.objects.using(using)
    has_display_level = any(field.name == "display_level" for field in CampusPlace._meta.fields)
    for order, data in enumerate(current_places()):
        defaults = {
            **builtin_fields(data), "map_version": MAP_VERSION,
            "entrance": data.get("entrance", ""), "floor": data.get("floor", ""),
            "body": data.get("description", ""),
        }
        if has_display_level:
            defaults["display_level"] = place_display_level(data["category"], data["id"], classroom=data["id"] in CLASSROOM_PARENTS)
        publication, _ = publications.get_or_create(
            key=f"builtin-{data['id']}", defaults={"kind": "place", "sort_order": order},
        )
        place, created = places.get_or_create(pk=data["id"], defaults={"publication": publication, **defaults})
        if not created and place.is_builtin and place.map_version == 1:
            old = builtin_fields(LEGACY_PLACES[place.pk]) if place.pk in LEGACY_PLACES else {}
            changes = {key: value for key, value in defaults.items()
                       if key in {"map_version", "map_x", "map_y"} or getattr(place, key) == old.get(key, "")}
            places.filter(pk=place.pk, map_version=1).update(**changes)
