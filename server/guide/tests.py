from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.exceptions import ValidationError
from django.test import Client, TestCase

from community.authentication import create_session

from .models import CampusPlace, CampusRoute, GuideCategory, GuidePost

class GuideTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_guide", verbosity=0)
        cls.admin_user = get_user_model().objects.create_superuser("testadmin", password="Test-pass-for-local-checks")

    def test_public_read_contains_four_categories_and_live_edits(self):
        self.assertEqual(len(self.client.get("/api/guide/").json()["categories"]), 4)
        self.assertTrue(all(entry["isCommunity"] is False for category in self.client.get("/api/guide/").json()["categories"] for entry in category["entries"]))
        entry = GuidePost.objects.get(publication__key="tips-1")
        entry.body = "管理员更新后的入学安排"
        entry.save()
        content = self.client.get("/api/guide/")
        self.assertContains(content, "管理员更新后的入学安排")
        self.assertIn("no-store", content.headers["Cache-Control"])

    def test_initial_feed_contains_the_four_source_articles(self):
        articles = self.client.get("/api/guide/").json()["articles"]
        self.assertEqual([article["title"] for article in articles], ["快捷链接", "HKU 指南", "HKU美食分享", "娱乐群"])
        self.assertTrue(all(article["body"] and article["publishedAt"] and article["markdown"] for article in articles))
        self.assertEqual(len(articles[1]["sourcePages"]), 3)
        self.assertEqual(len(articles[2]["sourcePages"]), 2)
        self.assertEqual(articles[3]["body"].count("![](/static/guide-originals/"), 11)

    def test_campus_classrooms_require_client_support_and_reference_buildings(self):
        old = self.client.get("/api/campus/?mapVersion=2").json()
        self.assertFalse(any(place["id"].startswith("classroom-") for place in old["basePlaces"]))
        self.assertIn("centennial-red-wall", {place["id"] for place in old["basePlaces"]})
        new = self.client.get("/api/campus/?mapVersion=2&classrooms=1").json()
        self.assertTrue(new["includesClassroomPlaces"])
        by_id = {place["id"]: place for place in new["basePlaces"]}
        rooms = [place for place in by_id.values() if "parentBuildingId" in place]
        self.assertEqual(len(rooms), 9)
        self.assertEqual(by_id["classroom-cycp2"]["parentBuildingId"], "cym-chemistry")
        self.assertEqual(by_id["classroom-cypp2"]["parentBuildingId"], "cym-physics")
        for room in rooms:
            self.assertIn(room["parentBuildingId"], by_id)
            self.assertEqual(room["displayLevel"], 4)
        self.assertEqual((by_id["gate"]["name"], by_id["gate"]["displayLevel"]), ("港大站 A2 出口", 1))
        self.assertEqual((by_id["library"]["x"], by_id["library"]["y"], by_id["library"]["displayLevel"]), (218.5, 218.08, 2))
        self.assertFalse({"library-old", "library-new"} & by_id.keys())
        self.assertEqual(by_id["centennial-red-wall"]["displayLevel"], 3)
        self.assertEqual(by_id["swire-hall"]["displayLevel"], 4)
        self.assertEqual(len(new["facilities"]), 32)
        self.assertTrue(all(item["displayLevel"] == 4 for item in new["facilities"]))

    def test_guest_comment_login_and_two_users_can_read_and_reply(self):
        article = GuidePost.objects.get(publication__key="student-guide-hku")
        url = f"/api/guide/articles/{article.pk}/comments/"
        first = {"body": "感谢整理", "request_id": str(uuid4())}
        self.assertEqual(self.client.post(url, first, content_type="application/json").status_code, 401)

        author = get_user_model().objects.create_user("guide_author")
        reader = get_user_model().objects.create_user("guide_reader")
        author_auth = {"HTTP_AUTHORIZATION": f"Bearer {create_session(author)}"}
        reader_auth = {"HTTP_AUTHORIZATION": f"Bearer {create_session(reader)}"}
        self.assertEqual(self.client.post(url, first, content_type="application/json", **author_auth).status_code, 201)
        self.assertEqual(self.client.post(url, first, content_type="application/json", **author_auth).status_code, 200)
        second = {"body": "同问八校通", "request_id": str(uuid4())}
        self.assertEqual(self.client.post(url, second, content_type="application/json", **reader_auth).status_code, 201)
        for auth in (author_auth, reader_auth):
            result = self.client.get(url, **auth).json()
            self.assertEqual(result["count"], 2)
            self.assertEqual([item["author"] for item in result["comments"]], ["guide_reader", "guide_author"])

    def test_like_is_idempotent_private_to_viewer_and_unpublished_articles_are_hidden(self):
        article = GuidePost.objects.get(publication__key="student-guide-links")
        url = f"/api/guide/articles/{article.pk}/like/"
        user = get_user_model().objects.create_user("guide_liker")
        auth = {"HTTP_AUTHORIZATION": f"Bearer {create_session(user)}"}
        self.assertEqual(self.client.put(url, {"liked": True}, content_type="application/json").status_code, 401)
        for _ in range(2):
            response = self.client.put(url, {"liked": True}, content_type="application/json", **auth)
            self.assertEqual(response.json(), {"liked": True, "likeCount": 1})
        self.assertTrue(self.client.get("/api/guide/", **auth).json()["articles"][0]["liked"])
        self.assertFalse(self.client.get("/api/guide/").json()["articles"][0]["liked"])
        response = self.client.put(url, {"liked": False}, content_type="application/json", **auth)
        self.assertEqual(response.json(), {"liked": False, "likeCount": 0})
        article.publication.published = False
        article.publication.save(update_fields=["published"])
        self.assertEqual(self.client.put(url, {"liked": True}, content_type="application/json", **auth).status_code, 404)
        self.assertEqual(self.client.get(f"/api/guide/articles/{article.pk}/comments/").status_code, 404)

    def test_place_discussion_is_public_and_existing_comments_use_current_nickname(self):
        user = get_user_model().objects.create_user("place_reader")
        auth = {"HTTP_AUTHORIZATION": f"Bearer {create_session(user)}"}
        url = "/api/campus/places/main/comments/"
        payload = {"body": "从正门进入很方便", "request_id": str(uuid4())}
        self.assertEqual(self.client.post(url, payload, content_type="application/json").status_code, 401)
        created = self.client.post(url, payload, content_type="application/json", **auth)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["comment"]["authorProfile"], {"name": "place_reader", "avatarUrl": ""})
        self.assertEqual(self.client.post(url, payload, content_type="application/json", **auth).status_code, 200)
        response = self.client.patch("/api/accounts/me/", {"nickname": "校园向导"}, content_type="application/json", **auth)
        self.assertEqual(response.status_code, 200)
        result = self.client.get(url).json()
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["comments"][0]["authorProfile"]["name"], "校园向导")
        self.assertEqual(self.client.get("/api/campus/places/gate/comments/").json()["count"], 0)
        place = CampusPlace.objects.get(pk="main")
        place.publication.published = False
        place.publication.save(update_fields=["published"])
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_unpublished_content_is_private(self):
        entry = GuidePost.objects.get(publication__key="tips-1")
        entry.publication.published = False
        entry.publication.save()
        self.assertNotContains(self.client.get("/api/guide/"), entry.body)

    def test_public_endpoint_rejects_writes_and_admin_requires_login(self):
        self.assertEqual(self.client.post("/api/guide/", {}).status_code, 405)
        response = self.client.get("/admin/guide/guidepost/")
        self.assertRedirects(response, "/admin/login/?next=/admin/guide/guidepost/")

    def test_admin_can_create_edit_and_delete(self):
        self.client.force_login(self.admin_user)
        values = {
            "key": "admin-roundtrip", "category": "tips", "title": "后台测试",
            "body": "创建的正文", "external_url": "", "image_url": "",
            "published": "on", "sort_order": "0", "_save": "保存",
        }
        response = self.client.post("/admin/guide/guidepost/add/", values)
        self.assertEqual(response.status_code, 302)
        entry = GuidePost.objects.get(title="后台测试")
        values["body"] = "后台编辑后的正文"
        self.assertEqual(self.client.post(f"/admin/guide/guidepost/{entry.pk}/change/", values).status_code, 302)
        self.assertContains(self.client.get("/api/guide/"), "后台编辑后的正文")
        self.assertEqual(self.client.post(f"/admin/guide/guidepost/{entry.pk}/delete/", {"post": "yes"}).status_code, 302)
        self.assertFalse(GuidePost.objects.filter(pk=entry.pk).exists())

    def test_seed_preserves_edits_and_does_not_duplicate(self):
        entry = GuidePost.objects.get(publication__key="tips-1")
        entry.title = "保留管理员修改"
        entry.save()
        count = GuidePost.objects.count()
        call_command("seed_guide", verbosity=0)
        self.assertEqual(GuidePost.objects.count(), count)
        entry.refresh_from_db()
        self.assertEqual(entry.title, "保留管理员修改")

    def test_admin_csrf_and_url_validation(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.admin_user)
        self.assertEqual(client.post("/admin/guide/guidepost/add/", {}).status_code, 403)
        entry = GuidePost.objects.get(publication__key="links-1")
        entry.external_url = "javascript:alert(1)"
        with self.assertRaises(ValidationError):
            entry.full_clean()

    def test_admin_adds_normalized_place_and_route(self):
        self.client.force_login(self.admin_user)
        result = self.client.post("/admin/guide/campusplace/add/", {
            "name_zh": "研讨室", "name_en": "Seminar Room", "abbreviation_en": "SR",
            "category": "study", "map_version": 2, "map_x": 100, "map_y": 200, "body": "测试地点说明",
            "published": "on", "sort_order": 100,
        })
        self.assertEqual(result.status_code, 302)
        place = CampusPlace.objects.get(abbreviation_en="SR")
        self.assertEqual(place.display_level, 4)
        result = self.client.post("/admin/guide/campusroute/add/", {
            "title": "去研讨室", "origin": "gate", "destination": place.pk, "body": "测试步行路线",
            "published": "on", "sort_order": 100,
            "steps-TOTAL_FORMS": 1, "steps-INITIAL_FORMS": 0,
            "steps-0-position": 0, "steps-0-title": "出发", "steps-0-body": "沿通道前行",
        })
        self.assertEqual(result.status_code, 302)
        route = CampusRoute.objects.get(title="去研讨室")
        self.assertEqual(route.destination_id, place.pk)
        self.assertEqual(route.steps.get().title, "出发")
        self.assertEqual(self.client.get("/api/campus/?mapVersion=2").json()["places"][0]["abbreviation"], "SR")
