"""Upgrade the fixture in a verified archive made before the content split."""
from datetime import datetime, timezone

from .legacy_catalog import builtin_fields, builtin_places, place_fields


def upgrade_legacy_fixture(records):
    legacy = [record for record in records if record["model"] == "guide.guideentry"]
    if not legacy:
        return records
    upgraded = [record for record in records if record["model"] != "guide.guideentry"]
    next_id = max(record["pk"] for record in legacy)
    photos = {
        (str(record["fields"]["submission"]), record["fields"]["step_index"]): record["pk"]
        for record in records if record["model"] == "community.submissionstepimage"
    }
    place_ids = set()
    routes = []

    def append(model, pk, fields):
        upgraded.append({"model": f"guide.{model}", "pk": pk, "fields": fields})

    def add_place(code, publication_id, fields):
        place_ids.add(code)
        append("campusplace", code, {"publication": publication_id, **fields})

    def new_place(code, fields, *, published=True, order=100, key):
        nonlocal next_id
        next_id += 1
        append("publication", next_id, {
            "key": key, "kind": "place", "published": published, "sort_order": order,
            "updated_at": datetime.now(timezone.utc).isoformat(), "current_submission": None,
        })
        add_place(code, next_id, fields)

    for record in legacy:
        pk, fields = record["pk"], record["fields"]
        data = fields.get("map_data") or {}
        kind = data.get("type", "post")
        common = {field: fields[field] for field in ("body", "external_url", "image_url")}
        append("publication", pk, {
            **{field: fields[field] for field in ("key", "published", "sort_order", "updated_at", "current_submission")},
            "kind": kind,
        })
        if kind == "place":
            add_place(f"community-place-{pk}", pk, {"name_zh": fields["title"], **common, **place_fields(data)})
        elif kind == "route":
            routes.append((pk, fields, data, common))
        elif kind == "post":
            append("guidepost", pk, {**common, **{field: fields[field] for field in ("category", "title", "is_example")}})
        else:
            raise ValueError(f"Unknown legacy content type for entry {pk}")

    for order, data in enumerate(builtin_places()):
        new_place(data["id"], builtin_fields(data), order=order, key=f"builtin-{data['id']}")
    for pk, fields, data, common in routes:
        origin, destination = data["originId"], data["destinationId"]
        for code in (origin, destination):
            if code not in place_ids:
                new_place(code, {"name_zh": "待补充地点", "category": "space", "map_x": 0, "map_y": 0, "body": ""},
                          published=False, key=f"legacy-missing-{code}")
        append("campusroute", pk, {**common, "title": fields["title"], "origin": origin, "destination": destination})
        for position, step in enumerate(data["steps"]):
            photo_id = photos.get((str(fields["current_submission"]), step.get("imageIndex", position)))
            append("routestep", None, {"route": pk, "position": position, "title": step["title"], "body": step["body"], "photo": photo_id})
    return upgraded
