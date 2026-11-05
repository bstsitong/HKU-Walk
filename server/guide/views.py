from django.db.models import Prefetch
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from django.urls import reverse

from .models import GuideCategory, GuideEntry

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
        } for entry in category.public_entries],
    } for category in categories]
    return JsonResponse({"categories": result}, json_dumps_params={"ensure_ascii": False})

@require_GET
@never_cache
def health(request):
    GuideCategory.objects.count()
    return JsonResponse({"status": "ok", "maintenance": settings.MAINTENANCE})
