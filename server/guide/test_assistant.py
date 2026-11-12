import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from .assistant_sources import search_web
from .models import AssistantUsage, CampusPlace, Publication


def tool_call(name, **arguments):
    return {"content": "", "tool_calls": [{"id": "call-1", "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)}}]}


@override_settings(ASSISTANT_MODEL="deepseek-flash", ASSISTANT_API_KEY="test-only", DEEPSEEK_API_KEY="")
class AssistantTests(TestCase):
    def setUp(self):
        cache.clear()
        self.url = reverse("assistant-ask")

    def add_place(self, code, outlets, published=True):
        publication = Publication.objects.create(key=code, kind="place", published=published)
        CampusPlace.objects.create(code=code, publication=publication, category="building", map_x=10, map_y=10,
                                   name_zh=code, has_power_outlets=outlets, power_outlet_location="1/F")

    def test_direct_answer_does_not_require_campus_sources(self):
        message = {"content": json.dumps({"kind": "general", "answer": "一加一等于二。"})}
        with patch("guide.assistant.model_message", return_value=message) as model:
            response = self.client.post(self.url, {"question": "一加一等于几"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"answer": "一加一等于二。", "sources": []})
        model.assert_called_once()

    @override_settings(ASSISTANT_API_BASE_URL="https://api.deepseek.com")
    def test_identity_uses_server_model_setting(self):
        message = {"content": json.dumps({"kind": "identity", "answer": "Untrusted model name"})}
        with patch("guide.assistant.model_message", return_value=message):
            response = self.client.post(self.url, {"question": "你是哪个模型"}, content_type="application/json")
        self.assertIn("DeepSeek V4.1 Flash", response.json()["answer"])
        self.assertNotIn("Untrusted model name", response.json()["answer"])
        self.assertEqual(response.json()["sources"], [])

    def test_campus_answer_without_tool_evidence_is_not_displayed(self):
        message = {"content": json.dumps({"answer": "The library is open all night.", "sources": [1]})}
        with patch("guide.assistant.model_message", return_value=message):
            response = self.client.post(self.url, {"question": "图书馆今晚几点关门"}, content_type="application/json")
        self.assertNotIn("open all night", response.json()["answer"])
        self.assertEqual(response.json()["sources"], [])

    def test_named_navigation_returns_a_campus_map_action(self):
        publication = Publication.objects.create(key="main-library", kind="place", published=True)
        CampusPlace.objects.create(code="library", publication=publication, category="study", map_x=10, map_y=10,
                                   name_zh="大学图书馆", name_en="Main Library")
        with patch("guide.assistant.model_message") as model:
            response = self.client.post(self.url, {"question": "带我去大学图书馆。"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([(item["kind"], item["id"]) for item in response.json()["sources"]], [("place", "library")])
        model.assert_not_called()

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_unknown_place_search_checks_the_name_and_asks_for_a_landmark(self):
        question = "学校里有叫奶龙的地方吗"
        with patch("guide.assistant.model_message", return_value=tool_call(
                "find_places", keywords=["奶龙", "奶龍"])), patch("guide.assistant.search_web", return_value=[]) as search:
            response = self.client.post(self.url, {"question": question}, content_type="application/json")
        search.assert_called_once_with(question, None, ["奶龙"])
        self.assertEqual(response.json()["sources"], [])
        self.assertIn("奶龙", response.json()["answer"])
        self.assertIn("地标", response.json()["answer"])

    def test_facility_results_require_a_published_confirmed_location(self):
        self.add_place("confirmed", True)
        self.add_place("unconfirmed", None)
        self.add_place("not-available", False)
        self.add_place("hidden", True, published=False)
        with patch("guide.assistant.model_message", return_value=tool_call(
                "find_places", keywords=[], category="building", has_power_outlets=True)) as model:
            response = self.client.post(self.url, {"question": "有插座的教学楼", "language": "en"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sources"], [
            {"kind": "place", "id": "confirmed", "title": "confirmed", "detail": "1/F"},
        ])
        self.assertEqual(model.call_count, 1)

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_missing_local_results_use_web_sources_without_inventing_place_actions(self):
        official = {"kind": "web", "id": "https://www.hku.hk/", "url": "https://www.hku.hk/",
                    "title": "HKU", "detail": "Official page", "evidence": "Official content"}
        with patch("guide.assistant.model_message", side_effect=[
            tool_call("find_guides", keywords=["missing-abc123"]),
            {"content": json.dumps({"answer": "See the official source.", "sources": [1, 999]})},
        ]) as model, patch("guide.assistant.search_web", return_value=[official]) as search:
            response = self.client.post(self.url, {"question": "What is missing-abc123?", "language": "en"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sources"][0]["kind"], "web")
        self.assertNotIn("evidence", response.json()["sources"][0])
        self.assertEqual(model.call_count, 2)
        search.assert_called_once()

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_web_search_keeps_matching_official_department_pages(self):
        with patch("guide.assistant_sources.post_json", side_effect=[{"results": [
            {"url": "https://www.cedars.hku.hk/menu", "title": "TamJai SamGor"},
            {"url": "https://catering.hku.hk/en/eateries/other/", "title": "Another restaurant"},
            {"url": "https://catering.hku.hk/en/eateries/CCOutletB/", "title": "TamJai SamGor"},
        ]}, {"content": "G/F The Jockey Club Tower"}]) as provider:
            result = search_web("TamJai SamGor site:example.com", "catering", ["TamJai SamGor"])
        self.assertEqual([item["id"] for item in result], ["https://catering.hku.hk/en/eateries/CCOutletB/"])
        self.assertEqual(provider.call_args_list[0].args[2]["query"], "TamJai SamGor site:catering.hku.hk")

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_search_can_read_the_official_directory_when_indexed_results_miss(self):
        with patch("guide.assistant_sources.post_json", return_value={"results": []}), patch(
                "guide.assistant_sources.read_hku_index", return_value="TamJai SamGor\nG/F The Jockey Club Tower, Centennial Campus"):
            result = search_web("TamJai SamGor", "catering", ["TamJai SamGor"])
        self.assertEqual(result[0]["url"], "https://catering.hku.hk/en/eateries/")
        self.assertIn("Centennial Campus", result[0]["evidence"])

    @override_settings(ASSISTANT_DAILY_LIMIT=1)
    def test_daily_limit_applies_before_provider_call(self):
        with patch("guide.assistant.model_message", return_value={"content": ""}) as model:
            self.assertEqual(self.client.post(self.url, {"question": "test"}, content_type="application/json").status_code, 200)
            second = self.client.post(self.url, {"question": "test"}, content_type="application/json")
        self.assertEqual(second.status_code, 429)
        self.assertEqual(AssistantUsage.objects.get().requests, 1)
        model.assert_called_once()

    @override_settings(ASSISTANT_API_KEY="")
    def test_missing_configuration_returns_an_explicit_state(self):
        response = self.client.post(self.url, {"question": "test"}, content_type="application/json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"code": "assistant_not_configured"})
