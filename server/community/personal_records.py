import re

from django.db import transaction
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from guide.map_display import canonical_place_id

from .models import PersonalRecords
from .views import PrivateResponseView


BOOKMARKS = ("saved_posts", "saved_places", "saved_routes")
HISTORY = ("recent_posts", "recent_places", "recent_routes")
COLLECTIONS = BOOKMARKS + HISTORY
HISTORY_LIMIT = 12
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
POST_ID = re.compile(r"[a-zA-Z0-9_-]+")
ROUTE_ID = re.compile(r"community-route-[0-9]+")
REMOVABLE_ROUTE_ID = re.compile(r"community-route-[0-9]+|demo:[a-z0-9-]+>[a-z0-9-]+")


def record_id(value):
    return value["id"] if isinstance(value, dict) else value


def valid_id(value, pattern, max_length=100):
    return isinstance(value, str) and len(value) <= max_length and bool(pattern.fullmatch(value))


def canonical_record(collection, value):
    if collection.endswith("_places"):
        return canonical_place_id(value)
    if not collection.endswith("_routes"):
        return value
    if isinstance(value, str):
        if not value.startswith("demo:"):
            return value
        origin, destination = value[5:].split(">")
        return f"demo:{canonical_place_id(origin)}>{canonical_place_id(destination)}"
    origin = canonical_place_id(value["originId"])
    destination = canonical_place_id(value["destinationId"])
    if origin == destination:
        return None
    identifier = f"demo:{origin}>{destination}" if value["source"] == "demo" else value["id"]
    return {**value, "id": identifier, "originId": origin, "destinationId": destination}


def canonical_collections(collections):
    result = {}
    for collection, items in collections.items():
        unique = {}
        for item in items:
            value = canonical_record(collection, item)
            if value is not None:
                unique.setdefault(record_id(value), value)
        result[collection] = list(unique.values())
    return result


def validate_value(collection, action, value):
    if collection.endswith("_posts"):
        if valid_id(value, POST_ID):
            return value
    elif collection.endswith("_places"):
        if valid_id(value, SLUG):
            return value
    elif action == "remove":
        if valid_id(value, REMOVABLE_ROUTE_ID, 206):
            return value
    elif isinstance(value, dict):
        origin, destination = value.get("originId"), value.get("destinationId")
        source, identifier = value.get("source"), value.get("id")
        if valid_id(origin, SLUG) and valid_id(destination, SLUG) and origin != destination:
            if (source == "demo" and identifier == f"demo:{origin}>{destination}") or (
                source == "community" and valid_id(identifier, ROUTE_ID)
            ):
                return {"id": identifier, "originId": origin, "destinationId": destination, "source": source}
    raise serializers.ValidationError("无效的收藏或浏览记录。")


class RecordChange(serializers.Serializer):
    collection = serializers.ChoiceField(choices=COLLECTIONS)
    action = serializers.ChoiceField(choices=("import", "save", "remove", "visit", "clear"))
    value = serializers.JSONField(required=False)

    def validate(self, attrs):
        collection, action = attrs["collection"], attrs["action"]
        allowed = ("import", "save", "remove") if collection in BOOKMARKS else ("import", "visit", "clear")
        if action not in allowed:
            raise serializers.ValidationError("此记录不支持该操作。")
        if action != "clear":
            attrs["value"] = validate_value(collection, action, attrs.get("value"))
        return attrs


class RecordChanges(serializers.Serializer):
    device = serializers.RegexField(r"\A[a-z0-9-]{16,64}\Z")
    first = serializers.IntegerField(min_value=1, max_value=2**53 - 101)
    changes = RecordChange(many=True, allow_empty=False, max_length=100)


def apply_change(records, change):
    collection, action = change["collection"], change["action"]
    if action == "clear":
        records.collections[collection] = []
        if collection not in records.cleared_history:
            records.cleared_history.append(collection)
        return

    value = canonical_record(collection, change["value"])
    if value is None:
        return
    identifier = record_id(value)
    items = records.collections.setdefault(collection, [])
    remaining = [item for item in items if record_id(item) != identifier]
    if action == "import":
        # A phone that upgrades later may still have a copy of an item removed elsewhere.
        if (len(remaining) == len(items) and collection not in records.cleared_history
                and identifier not in records.removed_bookmarks.get(collection, [])):
            items.append(value)
    elif action == "visit":
        records.collections[collection] = [value, *remaining]
    elif action == "save":
        blocked = records.removed_bookmarks.get(collection, [])
        if identifier in blocked:
            blocked.remove(identifier)
        if len(remaining) == len(items):
            items.append(value)
    else:
        blocked = records.removed_bookmarks.setdefault(collection, [])
        if identifier not in blocked:
            blocked.append(identifier)
        records.collections[collection] = remaining

    if collection in HISTORY:
        del records.collections[collection][HISTORY_LIMIT:]


class AccountRecords(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "personal_records"

    def get(self, request):
        records = PersonalRecords.objects.filter(user=request.user).values_list("collections", flat=True).first()
        return Response({"records": canonical_collections(records or {})})

    @transaction.atomic
    def patch(self, request):
        payload = RecordChanges(data=request.data)
        payload.is_valid(raise_exception=True)
        device, first, changes = (payload.validated_data[key] for key in ("device", "first", "changes"))
        records, _ = PersonalRecords.objects.select_for_update().get_or_create(user=request.user)
        previous = records.device_sequences.get(device, 0)
        latest = first + len(changes) - 1
        if latest > previous:
            records.collections = canonical_collections(records.collections)
            records.removed_bookmarks = canonical_collections(records.removed_bookmarks)
            for change in changes[max(0, previous - first + 1):]:
                apply_change(records, change)
            records.device_sequences[device] = latest
            records.save(update_fields=("collections", "device_sequences", "removed_bookmarks", "cleared_history"))
        return Response({"records": canonical_collections(records.collections)})
