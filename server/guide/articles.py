from django.db.models import Q
from django.utils import timezone

from .seed_content import read_catalog


ARTICLE_KEYS = (
    "student-guide-links", "student-guide-hku", "student-guide-food", "student-guide-groups",
)
ARTICLE_SCOPE = Q(publication__key__in=ARTICLE_KEYS) | Q(publication__current_submission__isnull=False)


def seed_articles(GuideCategory, GuidePost, Publication, using="default"):
    categories = GuideCategory.objects.using(using)
    publications = Publication.objects.using(using)
    posts = GuidePost.objects.using(using)
    for index, article in enumerate(read_catalog("student_guide_articles.json")):
        group, _ = categories.get_or_create(pk=article["category"], defaults={"title": article["title"], "sort_order": index})
        publication, _ = publications.get_or_create(key=ARTICLE_KEYS[index], defaults={"kind": "post", "sort_order": index})
        body = article["body"]
        posts.get_or_create(publication=publication, defaults={
            "category": group, "title": article["title"], "body": body,
            "source_pages": article.get("sourcePages", {}), "contributor": article.get("contributor", ""),
            "published_at": timezone.now(),
        })
