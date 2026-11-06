from django.db.models import Prefetch
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from django.urls import reverse

from .models import GuideCategory, GuideEntry
from community.map_content import BASE_PLACE_IDS, enrich_map_data

def entry_image(request, entry):
    if entry.image_url:
        return entry.image_url
    contribution = entry.current_submission
    if contribution and contribution.image:
        return request.build_absolute_uri(reverse("submission-image", args=[contribution.pk]))
    return entry.image_url

@require_GET
@never_cache
def guide_content(request):
    categories = GuideCategory.objects.prefetch_related(Prefetch(
        "entries", queryset=GuideEntry.objects.filter(published=True).select_related("current_submission"), to_attr="public_entries"
    ))
    result = [{
        "key": category.key, "title": category.title,
        "subtitle": category.subtitle, "introduction": category.introduction,
        "entries": [{
            "id": str(entry.id), "title": entry.title, "body": entry.body,
            "externalUrl": entry.external_url, "imageUrl": entry_image(request, entry),
            "isExample": entry.is_example, "updatedAt": entry.updated_at.isoformat(),
            "isCommunity": entry.current_submission_id is not None,
            "mapType": entry.map_data.get("type", "") if isinstance(entry.map_data, dict) else "",
        } for entry in category.public_entries],
    } for category in categories]
    return JsonResponse({"categories": result}, json_dumps_params={"ensure_ascii": False})

@require_GET
@never_cache
def campus_content(request):
    entries = list(GuideEntry.objects.filter(published=True).exclude(map_data={})
        .select_related("current_submission").prefetch_related("current_submission__step_images"))
    places = []
    routes = []
    for entry in entries:
        data = entry.map_data if isinstance(entry.map_data, dict) else {}
        if data.get("type") == "place":
            places.append({"id": f"community-place-{entry.pk}", "entryId": str(entry.pk), "name": entry.title,
                "english": data.get("english", ""), "keywords": "", "category": data["category"],
                "x": data["x"], "y": data["y"], "description": entry.body,
                "entrance": data.get("entrance", ""), "floor": data.get("floor", ""),
                "imageUrl": entry_image(request, entry), "isCommunity": True})
    available = BASE_PLACE_IDS | {place["id"] for place in places}
    for entry in entries:
        data = entry.map_data if isinstance(entry.map_data, dict) else {}
        if data.get("type") == "route" and data.get("originId") in available and data.get("destinationId") in available:
            content = enrich_map_data(request, data, entry.current_submission)
            routes.append({"id": f"community-route-{entry.pk}", "entryId": str(entry.pk), "title": entry.title,
                "body": entry.body, "originId": data["originId"], "destinationId": data["destinationId"],
                "steps": content["steps"], "isCommunity": True, "updatedAt": entry.updated_at.isoformat()})
    return JsonResponse({"places": places, "routes": routes}, json_dumps_params={"ensure_ascii": False})

@require_GET
@never_cache
def health(request):
    GuideCategory.objects.count()
    return JsonResponse({"status": "ok", "maintenance": settings.MAINTENANCE})
