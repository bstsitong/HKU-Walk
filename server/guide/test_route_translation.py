from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import CampusPlace, CampusRoute, GuidePost, Publication, RouteStep
from .translation import route_source_texts


@override_settings(ASSISTANT_MODEL="translation-test", ASSISTANT_API_KEY="test-only", TRANSLATION_DAILY_LIMIT=200)
class RouteTranslationTests(TestCase):
    def setUp(self):
        cache.clear()
        places = []
        for index in range(2):
            publication = Publication.objects.create(kind="place", key=f"route-translation-place-{index}")
            places.append(CampusPlace.objects.create(publication=publication, code=f"translation-place-{index}",
                name_zh="地点", name_en="Place", category="building", map_x=10, map_y=10))
        self.publication = Publication.objects.create(kind="route", key="new-route-translation")
        self.route = CampusRoute.objects.create(publication=self.publication, origin=places[0], destination=places[1],
            title="Route to HW312", body="Walk straight")
        self.step = RouteStep.objects.create(route=self.route, position=0, title="Turn left", body="Go to HW312")
        self.url = reverse("route-translation", args=[self.route.pk])
        self.payload = {"language": "zh-Hans", "sourceVersion": self.publication.updated_at.isoformat(), "sourceTexts": route_source_texts(self.route)}

    def test_new_route_translates_all_texts_and_reuses_cache_without_changing_source(self):
        translated = ["前往 HW312", "直行", "左转", "前往 HW312"]
        with patch("guide.translation.translate_texts", return_value=translated) as ai:
            for _ in range(2):
                response = self.client.post(self.url, self.payload, content_type="application/json")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["texts"], translated)
            ai.assert_called_once_with(self.payload["sourceTexts"], "zh-Hans")
        self.step.refresh_from_db()
        self.assertEqual(self.step.title, "Turn left")
        self.assertFalse(GuidePost.objects.filter(publication=self.publication).exists())

    def test_language_caches_are_separate(self):
        with patch("guide.translation.translate_texts", return_value=self.payload["sourceTexts"]) as ai:
            for language in ["en", "zh-Hant", "zh-Hans", "en"]:
                self.assertEqual(self.client.post(self.url, {**self.payload, "language": language}, content_type="application/json").status_code, 200)
            self.assertEqual(ai.call_count, 3)

    def test_edited_step_requires_new_source_and_invalidates_cached_translation(self):
        with patch("guide.translation.translate_texts", side_effect=lambda texts, _: texts) as ai:
            self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 200)
            RouteStep.objects.filter(pk=self.step.pk).update(title="Turn right")
            self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 409)
            payload = {**self.payload, "sourceTexts": route_source_texts(self.route)}
            self.assertEqual(self.client.post(self.url, payload, content_type="application/json").json()["texts"][2], "Turn right")
            self.assertEqual(ai.call_count, 2)

    def test_unpublished_route_or_endpoint_cannot_use_cache(self):
        with patch("guide.translation.translate_texts", return_value=self.payload["sourceTexts"]) as ai:
            self.client.post(self.url, self.payload, content_type="application/json")
            Publication.objects.filter(pk=self.route.origin.publication_id).update(published=False)
            self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 404)
            ai.assert_called_once()

    def test_changes_while_ai_is_running_are_not_returned(self):
        def mutate(texts, language):
            RouteStep.objects.filter(pk=self.step.pk).update(body="Changed during translation")
            return texts
        with patch("guide.translation.translate_texts", side_effect=mutate):
            self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 409)

    @override_settings(TRANSLATION_DAILY_LIMIT=0)
    def test_budget_or_stale_source_never_calls_ai(self):
        with patch("guide.translation.translate_texts") as ai:
            self.assertEqual(self.client.post(self.url, {**self.payload, "sourceVersion": "old"}, content_type="application/json").status_code, 409)
            self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 429)
            ai.assert_not_called()
