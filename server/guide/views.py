from django.conf import settings
from django.db.models import Count, Exists, OuterRef, Prefetch, Value
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from community.profiles import public_author_data
from community.body_content import published_body_blocks

from .catalog import content_image, published_routes, route_steps_data
from .campus_map import LEGACY_PLACES, MAP_VERSION
from .articles import ARTICLE_KEYS, ARTICLE_SCOPE
from .models import CampusPlace, GuideCategory, GuideLike, GuidePost, Publication, RouteStep


def publication_author(request, publication):
    source = publication.current_submission
    return public_author_data(request, source.author, "show_post_author") if source else None


def guide_card(request, content, map_type=""):
    publication = content.publication
    return {
        "id": str(publication.pk), "title": content.title, "body": content.body,
        "authorProfile": publication_author(request, publication),
        "externalUrl": content.external_url, "imageUrl": content_image(request, content, publication),
        "isExample": getattr(content, "is_example", False), "updatedAt": publication.updated_at.isoformat(),
        "isCommunity": bool(map_type) or publication.current_submission_id is not None, "mapType": map_type,
    }


def article_card(request, post):
    publication = post.publication
    submission = publication.current_submission
    published_at = post.published_at or (submission.reviewed_at if submission else None)
    card = guide_card(request, post)
    author = card["authorProfile"]
    blocks = published_body_blocks(request, post, submission)
    return {
        **card,
        "contributor": author["name"] if author else post.contributor,
        "sourcePages": post.source_pages, "markdown": publication.key in ARTICLE_KEYS,
        "bodyBlocks": blocks, "relatedLocation": submission.location if blocks else "",
        "publishedAt": published_at.isoformat() if published_at else None,
        "likeCount": post.like_count, "commentCount": post.comment_count, "liked": post.viewer_liked,
    }


@never_cache
@api_view(["GET"])
@permission_classes([AllowAny])
def guide_content(request):
    posts = GuidePost.objects.filter(publication__published=True).select_related("publication__current_submission__author__profile")
    categories = GuideCategory.objects.prefetch_related(Prefetch("posts", queryset=posts.exclude(publication__key__in=ARTICLE_KEYS), to_attr="public_posts"))
    # Keep the existing guide shortcuts and bookmarks for shared places and routes.
    map_items = [
        *CampusPlace.objects.filter(publication__published=True, is_builtin=False).select_related("publication__current_submission__author__profile"),
        *published_routes().select_related("publication__current_submission__author__profile"),
    ]
    result = []
    for category in categories:
        entries = list(category.public_posts)
        if category.pk == "tips":
            entries.extend(map_items)
        entries.sort(key=lambda item: (item.publication.sort_order, item.publication_id))
        result.append({
            "key": category.key, "title": category.title,
            "subtitle": category.subtitle, "introduction": category.introduction,
            "entries": [
                guide_card(request, item, "" if item.publication.kind == Publication.Kind.POST else item.publication.kind)
                for item in entries
            ],
        })
    liked = Exists(GuideLike.objects.filter(post_id=OuterRef("pk"), user=request.user)) if request.user.is_authenticated else Value(False)
    articles = posts.filter(ARTICLE_SCOPE).prefetch_related("publication__current_submission__body_images").annotate(
        like_count=Count("likes", distinct=True), comment_count=Count("comments", distinct=True), viewer_liked=liked,
    ).order_by("publication__sort_order", "publication_id")
    return JsonResponse({"categories": result, "articles": [article_card(request, post) for post in articles]},
                        json_dumps_params={"ensure_ascii": False})


@require_GET
@never_cache
def campus_content(request):
    version = MAP_VERSION if request.GET.get("mapVersion") == str(MAP_VERSION) else 1
    places, base_places = [], []
    place_query = CampusPlace.objects.filter(publication__published=True).select_related("publication__current_submission__author__profile")
    for place in place_query.order_by("publication__sort_order", "publication_id"):
        data = {
            "id": place.pk, "entryId": str(place.publication_id), "name": place.name_zh,
            "english": place.name_en, "abbreviation": place.abbreviation_en, "keywords": place.keywords,
            "category": place.category, "x": place.map_x, "y": place.map_y, "description": place.body,
            "entrance": place.entrance, "floor": place.floor, "imageUrl": content_image(request, place, place.publication),
            "isCommunity": not place.is_builtin,
            "authorProfile": publication_author(request, place.publication),
        }
        if version == 1:
            if place.is_builtin and place.pk in LEGACY_PLACES:
                data.update(LEGACY_PLACES[place.pk])
            elif place.map_version != 1:
                continue
        else:
            data["mapPositionPending"] = place.map_version != version
        (base_places if place.is_builtin else places).append(data)
    visible_ids = {place["id"] for place in base_places + places}
    route_query = published_routes().select_related("publication__current_submission__author__profile").prefetch_related(
        Prefetch("steps", queryset=RouteStep.objects.select_related("photo")),
    ).order_by("publication__sort_order", "publication_id")
    routes = [{
        "id": f"community-route-{route.pk}", "entryId": str(route.pk), "title": route.title,
        "authorProfile": publication_author(request, route.publication),
        "body": route.body, "originId": route.origin_id, "destinationId": route.destination_id,
        "steps": route_steps_data(request, route), "isCommunity": True,
        "updatedAt": route.publication.updated_at.isoformat(),
    } for route in route_query if route.origin_id in visible_ids and route.destination_id in visible_ids]
    return JsonResponse({"mapVersion": version, "places": places, "routes": routes, "basePlaces": base_places}, json_dumps_params={"ensure_ascii": False})


@require_GET
@never_cache
def health(request):
    GuideCategory.objects.count()
    return JsonResponse({"status": "ok", "maintenance": settings.MAINTENANCE})
