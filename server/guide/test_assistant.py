import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from .assistant_sources import AssistantServiceError, search_route, search_web
from .models import AssistantUsage, CampusPlace, CampusRoute, Publication, RouteStep


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

    def add_walking_route(self, *, published=True):
        origin = CampusPlace.objects.create(
            code="gate", name_zh="港大站 A2 出口", name_en="HKU Station Exit A2", abbreviation_en="A2",
            publication=Publication.objects.create(key="exit-a2", kind="place"),
            category="access", map_x=10, map_y=10,
        )
        destination = CampusPlace.objects.create(
            code="chiwah", name_zh="智华馆", name_en="Chi Wah Learning Commons", abbreviation_en="CWLC",
            keywords="智華館 智华学习共享空间",
            publication=Publication.objects.create(key="chi-wah", kind="place"),
            category="study", map_x=20, map_y=20,
        )
        route = CampusRoute.objects.create(
            publication=Publication.objects.create(key="a2-chiwah-route", kind="route", published=published),
            origin=origin, destination=destination, title="Chi Wah Learning Commons",
        )
        RouteStep.objects.create(route=route, position=1, title="Walk to Haking Wong Building")
        RouteStep.objects.create(route=route, position=0, title="Exit at A2")
        return route

    def test_explicit_directions_use_published_route_steps_without_a_model_call(self):
        self.add_walking_route()
        for question, language in [
            ("如何从a2去智华馆", "zh-Hans"),
            ("從Ａ２到智華館怎麼走？", "zh-Hant"),
            ("How do I get from HKU Station Exit A2 to Chi Wah Learning Commons?", "en"),
            ("How do I get to CWLC from A2?", "en"),
        ]:
            with self.subTest(question=question), patch("guide.assistant.model_message") as model:
                response = self.client.post(self.url, {"question": question, "language": language}, content_type="application/json")
                self.assertEqual(response.status_code, 200)
                answer = response.json()
                self.assertIn("1. Exit at A2\n2. Walk to Haking Wong Building", answer["answer"])
                self.assertEqual([(item["kind"], item["id"]) for item in answer["sources"]], [("place", "chiwah")])
                model.assert_not_called()

    def test_route_tool_uses_published_steps_for_a_conversational_request(self):
        self.add_walking_route()
        with patch("guide.assistant.model_message", return_value=tool_call(
                "find_routes", origin="A2", destination="CWLC")) as model:
            response = self.client.post(self.url, {"question": "A2 出来要怎么去 CWLC 呀"}, content_type="application/json")
        self.assertIn("1. Exit at A2", response.json()["answer"])
        model.assert_called_once()

    def test_route_search_ignores_unpublished_routes_and_does_not_reverse_directions(self):
        route = self.add_walking_route(published=False)
        self.assertIsNone(search_route("A2", "智华馆"))
        route.publication.published = True
        route.publication.save(update_fields=["published"])
        self.assertIsNone(search_route("智华馆", "A2"))
        self.assertIsNone(search_route("A2", "another place"))

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

    def send_landmark_hint(self, question):
        return self.client.post(self.url, {"question": question, "history": [
            {"role": "user", "content": "学校里有叫奶龙的地方吗"},
            {"role": "assistant", "content": "我没查到叫「奶龙」的校园地点。它可能是昵称，你知道它附近有什么地标吗？"},
        ]}, content_type="application/json")

    def test_unknown_landmark_followup_asks_for_spelling_even_if_web_search_fails(self):
        with patch("guide.assistant.search_web", side_effect=AssistantServiceError) as search, patch(
                "guide.assistant.model_message") as model:
            response = self.send_landmark_hint("他在 nikk 楼")
        search.assert_called_once_with("nikk 楼", required_terms=["nikk"])
        model.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertIn("nikk 楼", response.json()["answer"])
        self.assertIn("英文拼写", response.json()["answer"])
        self.assertEqual(response.json()["sources"], [])

    def test_known_landmark_can_be_opened_without_confirming_the_original_place(self):
        self.add_place("邵逸夫楼", None)
        with patch("guide.assistant.model_message") as model:
            response = self.send_landmark_hint("它在邵逸夫楼。")
        model.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sources"][0]["id"], "邵逸夫楼")
        self.assertIn("原本要找的地点还需要确认", response.json()["answer"])

    def test_landmark_followup_omits_web_hits_with_unrelated_titles(self):
        results = [{"kind": "web", "id": "1", "url": "https://www.hku.hk/1", "title": "Department of Surgery"},
                   {"kind": "web", "id": "2", "url": "https://www.hku.hk/2", "title": "Nikki's staff page"},
                   {"kind": "web", "id": "3", "url": "https://www.hku.hk/3", "title": "NIKK Building"}]
        with patch("guide.assistant.search_web", return_value=results):
            response = self.send_landmark_hint("他在nikk楼")
        self.assertEqual([item["id"] for item in response.json()["sources"]], ["3"])

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_failed_web_lookup_explains_which_search_failed(self):
        with patch("guide.assistant.model_message", return_value=tool_call(
                "search_hku", query="HKU example")), patch("guide.assistant.search_web", side_effect=AssistantServiceError):
            response = self.client.post(self.url, {"question": "港大官网的最新公告"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("无法完成港大官网搜索", response.json()["answer"])
        self.assertEqual(response.json()["sources"], [])

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_sources_are_kept_if_the_model_returns_an_empty_summary(self):
        official = {"kind": "web", "id": "https://www.hku.hk/", "url": "https://www.hku.hk/",
                    "title": "HKU", "detail": "Official page", "evidence": "Official content"}
        with patch("guide.assistant.model_message", side_effect=[
            tool_call("search_hku", query="HKU example"), {"content": "   "},
        ]), patch("guide.assistant.search_web", return_value=[official]):
            response = self.client.post(self.url, {"question": "港大官网的最新公告"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("点开查看", response.json()["answer"])
        self.assertEqual(response.json()["sources"][0]["url"], official["url"])
        self.assertNotIn("evidence", response.json()["sources"][0])

    def test_place_records_can_answer_a_question_about_the_entrance(self):
        self.add_place("library", None)
        CampusPlace.objects.filter(code="library").update(name_zh="大学图书馆", entrance="从图书馆旧翼 G/F 进入。")
        with patch("guide.assistant.model_message", side_effect=[
            tool_call("find_places", keywords=["大学图书馆"]),
            {"content": json.dumps({"answer": "从图书馆旧翼 G/F 进入。", "sources": [1]})},
        ]) as model:
            response = self.client.post(self.url, {"question": "大学图书馆从哪里进去？"}, content_type="application/json")
        self.assertEqual(response.json()["answer"], "从图书馆旧翼 G/F 进入。")
        self.assertEqual(response.json()["sources"][0]["id"], "library")
        self.assertIn("从图书馆旧翼 G/F 进入。", model.call_args.args[0][-1]["content"])

    def test_place_card_survives_an_invalid_source_reference(self):
        self.add_place("library", None)
        with patch("guide.assistant.model_message", side_effect=[
            tool_call("find_places", keywords=["library"]),
            {"content": json.dumps({"answer": "Made-up directions", "sources": [99]})},
        ]):
            response = self.client.post(self.url, {"question": "Where is library?", "language": "en"}, content_type="application/json")
        self.assertEqual(response.json()["sources"][0]["id"], "library")
        self.assertNotIn("Made-up directions", response.json()["answer"])

    @override_settings(DEEPSEEK_API_KEY="test-only")
    def test_official_lookup_can_supplement_an_existing_place_result(self):
        self.add_place("library", None)
        CampusPlace.objects.filter(code="library").update(name_en="Main Library")
        initial = tool_call("find_places", keywords=["Main Library"])
        official_call = tool_call("search_hku", query="Main Library visitor access", site="library")["tool_calls"][0]
        initial["tool_calls"].append({**official_call, "id": "call-2"})
        official = {"kind": "web", "id": "https://lib.hku.hk/access", "url": "https://lib.hku.hk/access",
                    "title": "Library access", "detail": "", "evidence": "See visitor access requirements."}
        with patch("guide.assistant.model_message", side_effect=[
            initial, {"content": json.dumps({"answer": "See visitor access requirements.", "sources": [2]})}
        ]), patch("guide.assistant.search_web", return_value=[official]) as search:
            response = self.client.post(self.url, {"question": "Can visitors enter the Main Library?", "language": "en"},
                                        content_type="application/json")
        search.assert_called_once()
        self.assertEqual([item["kind"] for item in response.json()["sources"]], ["web"])

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
