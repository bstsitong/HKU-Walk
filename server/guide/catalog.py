from django.urls import reverse

from .models import CampusRoute, Publication


def published_routes():
    return CampusRoute.objects.filter(
        publication__published=True, origin__publication__published=True,
        destination__publication__published=True,
    )


def content_image(request, content, publication):
    if content.image_url:
        return content.image_url
    source = publication.current_submission
    if source and source.image:
        return request.build_absolute_uri(reverse("submission-image", args=[source.pk]))
    return ""


def route_steps_data(request, route):
    return [
        {
            "title": step.title, "body": step.body,
            "sourceIndex": step.photo.step_index if step.photo else step.position,
            "imageUrl": request.build_absolute_uri(reverse("submission-step-image", args=[step.photo_id])) if step.photo_id else "",
        }
        for step in route.steps.all()
    ]


def publication_map_data(request, publication, content):
    if publication.kind == Publication.Kind.PLACE:
        return {
            "type": "place", "category": content.category, "x": content.map_x, "y": content.map_y,
            "english": content.name_en, "abbreviation": content.abbreviation_en,
            "entrance": content.entrance, "floor": content.floor,
        }
    if publication.kind == Publication.Kind.ROUTE:
        return {
            "type": "route", "originId": content.origin_id, "destinationId": content.destination_id,
            "steps": route_steps_data(request, content),
        }
    return {}
