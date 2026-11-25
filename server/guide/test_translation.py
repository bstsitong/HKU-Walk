import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from community.models import Submission
from .models import GuideCategory, GuidePost, Publication
from .translation import translate_texts
from .assistant_sources import AssistantServiceError


@override_settings(ASSISTANT_MODEL="translation-test", ASSISTANT_API_KEY="test-only", TRANSLATION_DAILY_LIMIT=200)
class PostTranslationTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model
        cache.clear()
        user = get_user_model().objects.create_user(username="translation-author", password="test-password-123")
        category, _ = GuideCategory.objects.get_or_create(pk="tips", defaults={"title": "Tips"})
        submission = Submission.objects.create(author=user, kind="guide", title="Original", body="Body", status="approved")
        self.publication = Publication.objects.create(kind="post", key="translation-fixture", current_submission=submission)
        self.post = GuidePost.objects.create(publication=self.publication, category=category, title="Original", body="Body")
        self.url = reverse("post-translation", args=[self.post.pk])
        self.payload = {"language": "en", "sourceVersion": self.publication.updated_at.isoformat()}

    def test_only_explicit_requests_translate_and_repeated_requests_use_cache(self):
        with patch("guide.translation.translate_texts", return_value=["Translated", "Translated body", ""]) as ai:
            for _ in range(2):
                response = self.client.post(self.url, self.payload, content_type="application/json")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["title"], "Translated")
            ai.assert_called_once()
        self.post.refresh_from_db()
        self.assertEqual(self.post.title, "Original")

    def test_unpublished_post_cannot_use_cached_translation(self):
        with patch("guide.translation.translate_texts", return_value=["Translated", "Body", ""]):
            self.client.post(self.url, self.payload, content_type="application/json")
        Publication.objects.filter(pk=self.publication.pk).update(published=False)
        self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 404)

    def test_stale_source_does_not_call_ai(self):
        with patch("guide.translation.translate_texts") as ai:
            response = self.client.post(self.url, {**self.payload, "sourceVersion": "old-version"}, content_type="application/json")
        self.assertEqual(response.status_code, 409)
        ai.assert_not_called()

    @override_settings(TRANSLATION_DAILY_LIMIT=0)
    def test_budget_blocks_uncached_requests(self):
        with patch("guide.translation.translate_texts") as ai:
            self.assertEqual(self.client.post(self.url, self.payload, content_type="application/json").status_code, 429)
        ai.assert_not_called()

    def test_url_is_hidden_from_ai_and_restored_verbatim(self):
        def echo(_url, _key, body, timeout):
            values = json.loads(body["messages"][1]["content"])["texts"]
            self.assertNotIn("https://example.com/原文?q=1", values[0])
            return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"texts": values})}}]}
        with patch("guide.translation.post_json", side_effect=echo):
            result = translate_texts(["Link https://example.com/原文?q=1"], "en")
        self.assertEqual(result, ["Link https://example.com/原文?q=1"])

    def test_missing_blocks_or_invented_urls_are_rejected(self):
        for values in [[], ["https://invented.invalid/"]]:
            response = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"texts": values})}}]}
            with patch("guide.translation.post_json", return_value=response):
                with self.assertRaises(AssistantServiceError):
                    translate_texts(["Original"], "en")
