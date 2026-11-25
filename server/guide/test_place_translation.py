from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import CampusPlace, Publication


@override_settings(ASSISTANT_MODEL="translation-test", ASSISTANT_API_KEY="test-only", TRANSLATION_DAILY_LIMIT=200)
class PlaceTranslationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.publication = Publication.objects.create(kind="place", key="place-translation-fixture")
        self.place = CampusPlace.objects.create(publication=self.publication, code="place-translation-fixture",
            name_zh="自习室", name_en="Study room", category="study", map_version=2, map_x=10, map_y=20,
            body="这里适合自习，房间编号 HW312。")
        self.url = reverse("place-translation", args=[self.place.pk])
        self.payload = {"language": "en", "sourceVersion": self.publication.updated_at.isoformat(), "sourceTexts": [self.place.body]}

    def post(self, **changes):
        return self.client.post(self.url, {**self.payload, **changes}, content_type="application/json")

    def test_all_languages_cache_separately_and_preserve_original(self):
        with patch("guide.translation.translate_texts", side_effect=lambda texts, language: [language + " HW312"]) as ai:
            for language in ("en", "zh-Hans", "zh-Hant", "en"):
                response = self.post(language=language)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["texts"], [language + " HW312"])
            self.assertEqual(ai.call_count, 3)
        self.place.refresh_from_db()
        self.assertEqual(self.place.body, self.payload["sourceTexts"][0])

    def test_admin_edits_invalidate_cache_even_without_revision_change(self):
        with patch("guide.translation.translate_texts", side_effect=lambda texts, _: texts) as ai:
            self.assertEqual(self.post().status_code, 200)
            CampusPlace.objects.filter(pk=self.place.pk).update(body="新的地点简介")
            self.assertEqual(self.post().status_code, 409)
            self.assertEqual(self.post(sourceTexts=["新的地点简介"]).json()["texts"], ["新的地点简介"])
            self.assertEqual(ai.call_count, 2)

    def test_catalog_exposes_revision_and_accepts_older_catalog_without_one(self):
        public = self.client.get('/api/campus/?mapVersion=2&classrooms=1').json()["places"]
        self.assertEqual(public[0]["updatedAt"], self.payload["sourceVersion"])
        with patch("guide.translation.translate_texts", return_value=["Translated"]):
            self.assertEqual(self.post(sourceVersion="").status_code, 200)
            self.assertEqual(self.post(sourceVersion="old").status_code, 409)

    def test_empty_intro_needs_no_ai_even_when_provider_is_unavailable(self):
        CampusPlace.objects.filter(pk=self.place.pk).update(body="")
        with override_settings(ASSISTANT_API_KEY=""), patch("guide.translation.translate_texts") as ai:
            self.assertEqual(self.post(sourceTexts=[""]).json()["texts"], [""])
            ai.assert_not_called()

    def test_unpublished_or_removed_place_cannot_use_cached_translation(self):
        with patch("guide.translation.translate_texts", return_value=["Translated"]):
            self.assertEqual(self.post().status_code, 200)
            for values in ({"published": False}, {"published": False, "removed_by_author": True}):
                Publication.objects.filter(pk=self.publication.pk).update(**values)
                self.assertEqual(self.post().status_code, 404)

    def test_edit_while_translation_is_running_is_not_returned(self):
        def mutate(texts, language):
            CampusPlace.objects.filter(pk=self.place.pk).update(body="Edited while translating")
            return texts
        with patch("guide.translation.translate_texts", side_effect=mutate):
            self.assertEqual(self.post().status_code, 409)

    def test_unavailable_provider_reports_failure_instead_of_source_as_translation(self):
        with override_settings(ASSISTANT_API_KEY=""), patch("guide.translation.translate_texts") as ai:
            self.assertEqual(self.post().status_code, 503)
            ai.assert_not_called()

    def test_admin_place_form_hides_legacy_fields_and_saves_empty_intro(self):
        admin = get_user_model().objects.create_superuser("placeadmin", password="Local-test-password")
        self.client.force_login(admin)
        url = reverse("admin:guide_campusplace_change", args=[self.place.pk])
        response = self.client.get(url)
        self.assertContains(response, '地点简介')
        self.assertNotContains(response, 'id_entrance')
        self.assertNotContains(response, 'id_floor')
        field = response.context["adminform"].form.fields["body"]
        self.assertEqual(field.label, "地点简介")
        self.assertFalse(field.required)
        response = self.client.post(url, {
            "name_zh": self.place.name_zh, "name_en": self.place.name_en, "abbreviation_en": "", "keywords": "",
            "category": "study", "display_level": 4, "map_version": 2, "map_x": 10, "map_y": 20,
            "body": "", "has_power_outlets": "unknown", "power_outlet_location": "", "external_url": "",
            "image_url": "", "published": "on", "sort_order": 100, "_save": "保存",
        })
        self.assertEqual(response.status_code, 302)
        self.place.refresh_from_db()
        self.assertEqual(self.place.body, "")
        self.assertEqual(self.post(sourceTexts=[""], sourceVersion="").json()["texts"], [""])
