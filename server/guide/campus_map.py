"""Load the campus catalog while keeping published place identities stable."""
import json
from functools import cache
from pathlib import Path

from .legacy_catalog import builtin_fields, builtin_places


MAP_VERSION = 2
LEGACY_PLACES = {place["id"]: place for place in builtin_places()}


@cache
def current_places():
    return json.loads(Path(__file__).with_name("base_places_v2.json").read_text(encoding="utf-8"))


def seed_current_places(Publication, CampusPlace, using="default"):
    publications = Publication.objects.using(using)
    places = CampusPlace.objects.using(using)
    for order, data in enumerate(current_places()):
        defaults = {
            **builtin_fields(data), "map_version": MAP_VERSION,
            "entrance": data.get("entrance", ""), "floor": data.get("floor", ""),
        }
        publication, _ = publications.get_or_create(
            key=f"builtin-{data['id']}", defaults={"kind": "place", "sort_order": order},
        )
        place, created = places.get_or_create(pk=data["id"], defaults={"publication": publication, **defaults})
        if not created and place.is_builtin and place.map_version == 1:
            old = builtin_fields(LEGACY_PLACES[place.pk]) if place.pk in LEGACY_PLACES else {}
            changes = {key: value for key, value in defaults.items()
                       if key in {"map_version", "map_x", "map_y"} or getattr(place, key) == old.get(key, "")}
            places.filter(pk=place.pk, map_version=1).update(**changes)
