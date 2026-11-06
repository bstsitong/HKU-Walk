"""Merge the student guide into the built-in catalog, retaining post identities."""
import json
from pathlib import Path


def read_catalog(filename):
    return json.loads(Path(__file__).with_name(filename).read_text(encoding="utf-8"))


def matches_seed(post, group, entry):
    return (
        post.category_id == group.pk
        and post.title == entry["title"]
        and post.body == entry["body"]
        and post.external_url == entry.get("external_url", "")
        and post.is_example == entry.get("is_example", False)
        and not post.image_url
        and not post.publication.current_submission_id
    )


def seed_posts(GuideCategory, GuidePost, Publication, using="default", refresh_defaults=False):
    groups = GuideCategory.objects.using(using)
    posts = GuidePost.objects.using(using)
    publications = Publication.objects.using(using)
    imported = {category["key"]: category for category in read_catalog("student_guide_hku_v1.json")}
    for order, base in enumerate(read_catalog("seed.json")):
        source = imported[base["key"]]
        group, _ = groups.get_or_create(key=base["key"], defaults={
            "title": base["title"], "subtitle": base["subtitle"],
            "introduction": source["introduction"], "sort_order": order,
        })
        if refresh_defaults and group.introduction == base["introduction"]:
            groups.filter(pk=group.pk, introduction=base["introduction"]).update(introduction=source["introduction"])

        original = {entry["key"]: (index, entry) for index, entry in enumerate(base["entries"])}
        source_keys = {entry["key"] for entry in source["entries"]}
        additions = [entry for entry in base["entries"] if entry["key"] not in source_keys and not entry.get("is_example")]
        for position, entry in enumerate(source["entries"] + additions):
            key = entry["key"]
            defaults = {field: value for field, value in entry.items() if field != "key"}
            publication, _ = publications.get_or_create(key=key, defaults={"kind": "post", "sort_order": position})
            if publication.kind != "post":
                continue
            post, created = posts.get_or_create(publication=publication, defaults={**defaults, "category": group})
            if refresh_defaults and not created and key in original:
                old_position, old_entry = original[key]
                if matches_seed(post, group, old_entry):
                    posts.filter(pk=post.pk).update(**defaults)
                    publications.filter(pk=publication.pk, sort_order=old_position).update(sort_order=position)

        if refresh_defaults:
            for key, (_, entry) in original.items():
                if not entry.get("is_example") or key in source_keys:
                    continue
                post = posts.select_related("publication").filter(publication__key=key).first()
                if post and matches_seed(post, group, entry):
                    publications.filter(pk=post.publication_id).update(published=False)
