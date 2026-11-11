from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class SeparateContentMigrationTests(TransactionTestCase):
    def test_existing_posts_places_routes_and_photo_links_keep_their_ids(self):
        # Remove newer submission fields before SQLite restores the old guide entry relation.
        before = [("community", "0004_submission_map_data_alter_submission_kind_and_more"),
                  ("guide", "0004_guideentry_map_data")]
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        executor.migrate(before)
        old = executor.loader.project_state(before).apps
        try:
            user = old.get_model("auth", "User").objects.create(username="legacy_author")
            category = old.get_model("guide", "GuideCategory").objects.create(key="tips", title="Tips")
            entries = old.get_model("guide", "GuideEntry").objects
            post = entries.create(category=category, title="Existing post", body="Post body")
            place = entries.create(category=category, title="旧入口", body="Place body",
                                   map_data={"type": "place", "english": "Old entrance", "category": "access", "x": 12, "y": 34})
            place_code = f"community-place-{place.pk}"
            submissions = old.get_model("community", "Submission").objects
            contribution = submissions.create(author=user, kind="new_route", status="approved", request_key="legacy_route")
            photo = old.get_model("community", "SubmissionStepImage").objects.create(
                submission=contribution, step_index=1, image="contributions/steps/legacy.jpg")
            route = entries.create(category=category, title="Existing route", body="Route body",
                                   current_submission=contribution, map_data={
                                       "type": "route", "originId": "gate", "destinationId": place_code,
                                       "steps": [{"title": "Legacy step", "body": "Walk", "imageIndex": 1}],
                                   })
            submissions.filter(pk=contribution.pk).update(public_entry=route)
            edit = submissions.create(author=user, kind="new_route", request_key="legacy_edit",
                                      edit_of=route, base_entry_updated_at=route.updated_at)
        finally:
            MigrationExecutor(connection).migrate(latest)

        from community.models import Submission
        from .models import CampusPlace, CampusRoute, GuidePost, Publication

        self.assertEqual(GuidePost.objects.get(pk=post.pk).title, "Existing post")
        self.assertEqual(CampusPlace.objects.get(pk=place_code).publication_id, place.pk)
        self.assertEqual(CampusPlace.objects.get(pk=place_code).name_en, "Old entrance")
        migrated = CampusRoute.objects.get(pk=route.pk)
        self.assertEqual((migrated.origin_id, migrated.destination_id), ("gate", place_code))
        self.assertEqual(migrated.steps.get().photo_id, photo.pk)
        self.assertEqual(migrated.publication.current_submission_id, contribution.pk)
        self.assertEqual(migrated.publication.updated_at, route.updated_at)
        self.assertEqual(Submission.objects.get(pk=contribution.pk).public_entry_id, route.pk)
        self.assertEqual(Submission.objects.get(pk=edit.pk).edit_of_id, route.pk)
        self.assertFalse(GuidePost.objects.filter(pk__in=[place.pk, route.pk]).exists())
        self.assertTrue(Publication.objects.filter(key='hku-doc-food-around-hku', published=True).exists())
        self.assertEqual(CampusPlace.objects.get(pk=place_code).map_version, 1)
        self.assertEqual(CampusPlace.objects.get(pk="gate").map_version, 2)
