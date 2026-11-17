import copy
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from guide.campus_map import MAP_VERSION
from guide.catalog import published_routes
from guide.map_display import canonical_place_id
from guide.models import CampusPlace

PLACE_CATEGORIES = set(CampusPlace.Category.values)
MAX_ROUTE_STEPS = 20

def place_exists(identifier):
    return CampusPlace.objects.filter(pk=identifier, publication__published=True).exists()

def text(data, key, limit, required=False):
    value = data.get(key, "")
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValidationError({"map_data": "地点或路线资料不完整，请检查名称、位置和步骤。"})
    return value.strip()

def validate_map_data(kind, data):
    if not isinstance(data, dict):
        raise ValidationError({"map_data": "地点或路线资料格式不正确。"})
    if kind == "new_place":
        category = data.get("category")
        if not isinstance(category, str) or category not in PLACE_CATEGORIES:
            raise ValidationError({"map_data": "请选择地点类别。"})
        coordinates = {}
        for key, maximum in [("x", 360), ("y", 580)]:
            value = data.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= maximum:
                raise ValidationError({"map_data": "请在校园示意图上选择地点位置。"})
            coordinates[key] = round(value, 3)
        result = {"type": "place", "category": category, **coordinates,
            "english": text(data, "english", 160), "entrance": text(data, "entrance", 1000), "floor": text(data, "floor", 500)}
        version = data.get("mapVersion", 1)
        if type(version) is not int or version not in (1, MAP_VERSION):
            raise ValidationError({"map_data": "底图版本不支持，请重新选择地点位置。"})
        result["mapVersion"] = version
        if "abbreviation" in data:
            result["abbreviation"] = text(data, "abbreviation", 40)
        return result
    if kind == "place" and data:
        place_id = canonical_place_id(text(data, "placeId", 80, True))
        if not place_exists(place_id):
            raise ValidationError({"map_data": "需要纠错的地点已下线，请重新选择。"})
        return {"type": "place_correction", "placeId": place_id}
    if kind == "new_route" or (kind == "route" and data):
        origin = canonical_place_id(text(data, "originId", 80, True))
        destination = canonical_place_id(text(data, "destinationId", 80, True))
        if origin == destination:
            raise ValidationError({"map_data": "起点和终点不能相同。"})
        if not place_exists(origin) or not place_exists(destination):
            raise ValidationError({"map_data": "起点或终点已下线，请重新选择。"})
        if kind == "route":
            route_id = text(data, "routeId", 80)
            routes = published_routes().filter(origin_id=origin, destination_id=destination)
            if route_id and (not route_id.isascii() or not route_id.isdecimal() or len(route_id) > 19
                             or int(route_id) > 9223372036854775807
                             or not routes.filter(pk=int(route_id)).exists()):
                raise ValidationError({"map_data": "需要纠错的路线已变化，请重新选择。"})
            return {"type": "route_correction", "originId": origin, "destinationId": destination, "routeId": route_id}
        steps = data.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_ROUTE_STEPS:
            raise ValidationError({"map_data": "路线需要 1–20 个步骤。"})
        clean = []
        for step in steps:
            if not isinstance(step, dict):
                raise ValidationError({"map_data": "每一步都需要标题。"})
            clean.append({"title": text(step, "title", 160, True), "body": text(step, "body", 1500)})
        return {"type": "route", "originId": origin, "destinationId": destination, "steps": clean}
    if data:
        raise ValidationError({"map_data": "此投稿类型不包含地点或路线资料。"})
    return {}


def correction_location(data):
    if data.get("type") == "place_correction":
        return CampusPlace.objects.filter(pk=data["placeId"]).values_list("name_zh", flat=True).first() or data["placeId"]
    if data.get("type") == "route_correction":
        places = CampusPlace.objects.in_bulk([data["originId"], data["destinationId"]])
        origin, destination = (places[data[key]].name_zh if data[key] in places else data[key] for key in ("originId", "destinationId"))
        if data["routeId"]:
            title = published_routes().filter(pk=int(data["routeId"])).values_list("title", flat=True).first()
            if title:
                return f"{origin[:42]} → {destination[:42]} · {title[:70]}"
        return f"{origin[:78]} → {destination[:78]}"
    return ""

def enrich_map_data(request, data, source):
    result = copy.deepcopy(data or {})
    if result.get("type") == "route" and source:
        images = {image.step_index: image for image in source.step_images.all()}
        for index, step in enumerate(result.get("steps", [])):
            image_index = step.get("imageIndex", index)
            image = images.get(image_index)
            step["imageUrl"] = request.build_absolute_uri(reverse("submission-step-image", args=[image.pk])) if image else ""
            step["sourceIndex"] = image_index
    return result
