import io
import json
import tempfile
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from PIL import Image
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from guide.models import GuidePost
from .authentication import create_session
from .models import MobileSession, Submission
from .services import ReviewConflict, review_submission


def photo():
    buffer = io.BytesIO()
    image = Image.new("RGB", (1800, 900), "#347258")
    exif = Image.Exif()
    exif[270] = "private metadata"
    image.save(buffer, "JPEG", exif=exif)
    return SimpleUploadedFile("photo.jpg", buffer.getvalue(), content_type="image/jpeg")


class CommunityFixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_guide", verbosity=0)
        users = get_user_model()
        cls.owner = users.objects.create_user("student_one", password="Campus-check-5296")
        cls.other = users.objects.create_user("student_two", password="Campus-check-5296")
        cls.admin = users.objects.create_superuser("review_admin", password="Admin-check-9752")

    def setUp(self):
        cache.clear()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.media = override_settings(MEDIA_ROOT=self.directory.name)
        self.media.enable()
        self.addCleanup(self.media.disable)
        self.api = APIClient()
        self.token = create_session(self.owner)
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.anon = APIClient()
        self.payload = {"kind": "food", "title": "测试校园美食推荐", "body": "这是一条用于验证审核流程的校园推荐。", "request_key": "request_key_001"}

    def submit(self, **patch):
        data = {**self.payload, **patch}
        response = self.api.post("/api/submissions/", data, format="multipart" if "image" in data else "json")
        self.assertEqual(response.status_code, 201, response.content)
        return Submission.objects.get(pk=response.json()["submission"]["id"])

    def assert_image_status(self, client, path, status):
        response = client.get(path)
        try:
            self.assertEqual(response.status_code, status)
        finally:
            response.close()

class CommunityTests(CommunityFixture):
    def test_admin_review_queue_matches_mobile_types_and_includes_legacy_guide_submissions(self):
        legacy = self.submit(title="旧版美食投稿")
        place = self.submit(kind="place", title="待核对的校园地点", location="本部大楼", request_key="admin_place")
        review_submission(place.pk, 1, "approved", "", self.admin)
        self.client.force_login(self.admin)

        home = self.client.get("/admin/")
        self.assertContains(home, "查看待审核")
        self.assertContains(home, "/admin/community/submission/?status__exact=pending")
        path = "/admin/community/submission/"
        queue = self.client.get(path, {"status__exact": "pending", "type": "guide"})
        self.assertContains(queue, legacy.title)
        self.assertNotContains(queue, place.title)
        for label in ("新地点", "地点纠错", "新线路", "线路纠错", "学生指南"):
            self.assertContains(queue, label)
        self.assertNotContains(queue, "美食推荐")
        self.assertNotContains(queue, "娱乐群资料")

        detail = self.client.get(f"{path}{place.pk}/change/")
        self.assertContains(detail, "审核记录")
        self.assertNotContains(detail, "提交审核结果")

    def test_illustrated_guide_submission_keeps_layout_and_private_images_through_revision(self):
        endpoint = "/api/submissions/"
        blocks = [{"type": "heading", "text": "图书馆"}, {"type": "paragraph", "text": "从入口直走。"},
                  {"type": "image", "text": "入口照片"}, {"type": "list", "text": "带学生证\n留意开放时间"}]

        def payload():
            return {"kind": "guide", "title": "图书馆攻略", "body": "", "body_blocks": json.dumps(blocks),
                    "body_image_2": photo(), "request_key": "rich_guide_submission"}

        response = self.api.post(endpoint, payload(), format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        item = response.json()["submission"]
        self.assertEqual(self.api.post(endpoint, payload(), format="multipart").status_code, 200)
        original_path = urlsplit(item["bodyBlocks"][2]["imageUrl"]).path
        self.assert_image_status(self.api, original_path, 200)
        self.assertEqual(self.anon.get(original_path).status_code, 404)
        self.assertNotContains(self.anon.get("/api/guide/"), item["title"])
        self.client.force_login(self.admin)
        review = self.client.get(f"/admin/community/submission/{item['id']}/change/")
        self.assertContains(review, original_path)
        self.assertContains(review, "<h3>图书馆</h3>", html=True)

        returned = review_submission(item["id"], 1, "changes_requested", "先展示入口照片", self.admin)
        revised = self.api.patch(endpoint + item["id"] + "/", {
            "kind": "guide", "title": item["title"], "body": "", "revision": returned.revision,
            "body_blocks": [blocks[2], blocks[0], blocks[1], blocks[3]], "inherit_body_images": {"0": 2},
        }, format="json")
        self.assertEqual(revised.status_code, 200, revised.content)
        ordered = revised.json()["submission"]["bodyBlocks"]
        path = urlsplit(ordered[0]["imageUrl"]).path
        self.assertEqual(self.anon.get(path).status_code, 404)
        approved = review_submission(item["id"], returned.revision + 1, "approved", "", self.admin)
        article = next(post for post in self.anon.get("/api/guide/").json()["articles"] if post["id"] == str(approved.public_entry_id))
        self.assertEqual([block["type"] for block in article["bodyBlocks"]], ["image", "heading", "paragraph", "list"])
        self.assert_image_status(self.anon, path, 200)
        self.assertEqual(self.anon.get(original_path).status_code, 404)

        current = self.api.get(endpoint + item["id"] + "/").json()["submission"]["publishedContent"]
        edit = self.api.post(endpoint + item["id"] + "/edits/", {
            "kind": "guide", "title": item["title"], "body": "", "base_version": current["version"],
            "body_blocks": [blocks[0], blocks[2], blocks[1], blocks[3]], "inherit_body_images": {"1": 0},
            "request_key": "edit_rich_guide",
        }, format="json")
        self.assertEqual(edit.status_code, 201, edit.content)
        replacement = edit.json()["submission"]
        new_path = urlsplit(replacement["bodyBlocks"][1]["imageUrl"]).path
        self.assertEqual(self.anon.get(new_path).status_code, 404)
        review_submission(replacement["id"], 1, "approved", "", self.admin)
        self.assertEqual(self.anon.get(path).status_code, 404)
        self.assert_image_status(self.anon, new_path, 200)

    def test_structured_corrections_select_published_targets(self):
        endpoint = "/api/submissions/"
        base = {"title": "入口提示", "body": "", "body_blocks": [{"type": "paragraph", "text": "入口标志已经更换。"}]}
        for kind, target in (("place", {}), ("place", {"placeId": "missing"}),
                             ("route", {"originId": "gate", "destinationId": "gate"}),
                             ("route", {"originId": "gate", "destinationId": "main", "routeId": "999999"})):
            response = self.api.post(endpoint, {**base, "kind": kind, "map_data": target}, format="json")
            self.assertEqual(response.status_code, 400, response.content)
        for kind, target in (("place", {"placeId": "main"}), ("route", {"originId": "gate", "destinationId": "main"})):
            response = self.api.post(endpoint, {**base, "kind": kind, "map_data": target,
                                                "request_key": f"correction_{kind}"}, format="json")
            self.assertEqual(response.status_code, 201, response.content)
            item = response.json()["submission"]
            self.assertEqual(item["mapData"]["type"], f"{kind}_correction")
            self.assertTrue(item["location"])
            self.client.force_login(self.admin)
            detail = self.client.get(f"/admin/community/submission/{item['id']}/change/")
            self.assertContains(detail, "/admin/guide/campusplace/main/change/")
            self.assertContains(detail, "纠错说明")
            self.assertNotContains(detail, "originId")
            approved = review_submission(item["id"], 1, "approved", "", self.admin)
            article = next(post for post in self.anon.get("/api/guide/").json()["articles"] if post["id"] == str(approved.public_entry_id))
            self.assertEqual(article["relatedLocation"], item["location"])

    def test_new_route_template_requires_a_photo_per_step(self):
        data = {"kind": "new_route", "title": "港大站到本部大楼", "body": "", "request_key": "route_template",
                "map_data": json.dumps({"originId": "gate", "destinationId": "main", "stepPhotosRequired": True,
                                        "steps": [{"title": "找到指示牌", "body": "沿指示牌向前走。"}]})}
        self.assertEqual(self.api.post("/api/submissions/", data, format="multipart").status_code, 400)
        response = self.api.post("/api/submissions/", {**data, "step_image_0": photo()}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        item = response.json()["submission"]
        path = urlsplit(item["mapData"]["steps"][0]["imageUrl"]).path
        self.client.force_login(self.admin)
        detail = self.client.get(f"/admin/community/submission/{item['id']}/change/")
        self.assertContains(detail, "找到指示牌")
        self.assertContains(detail, "第 1 步配图")
        self.assertContains(detail, path)
        self.assertContains(detail, "提交审核结果")
        self.assertEqual(self.anon.get(path).status_code, 404)
        approved = review_submission(item["id"], 1, "approved", "", self.admin)
        route = next(route for route in self.anon.get("/api/campus/").json()["routes"]
                     if route["entryId"] == str(approved.public_entry_id))
        self.assertEqual(urlsplit(route["steps"][0]["imageUrl"]).path, path)
        self.assert_image_status(self.anon, path, 200)

    def test_privacy_controls_hide_public_identity_and_revoke_public_profile(self):
        settings_url = "/api/accounts/privacy/"
        default = {"showPostAuthor": True, "showCommentAuthor": True, "publicProfile": False}
        self.assertEqual(self.anon.get(settings_url).status_code, 401)
        self.assertEqual(self.anon.patch(settings_url, {"publicProfile": True}, format="json").status_code, 401)
        self.assertEqual(self.api.get(settings_url).json()["privacy"], default)
        self.assertEqual(self.api.patch(settings_url, {"showPostAuthor": "unclear"}, format="json").status_code, 400)
        self.assertEqual(self.api.patch("/api/accounts/me/", {"nickname": "校园漫步者", "bio": "我的简介", "avatar": photo()},
                                        format="multipart").status_code, 200)
        item = self.submit()
        review_submission(item.pk, item.revision, "approved", "", self.admin)
        item.refresh_from_db()
        GuidePost.objects.filter(pk=item.public_entry_id).update(contributor=self.owner.username)
        comment_paths = (f"/api/guide/articles/{item.public_entry_id}/comments/", "/api/campus/places/main/comments/")
        for url in comment_paths:
            self.assertEqual(self.api.post(url, {"body": "早期评论", "request_id": str(uuid4())}, format="json").status_code, 201)

        def public_article():
            return next(article for article in self.anon.get("/api/guide/").json()["articles"] if article["id"] == str(item.public_entry_id))

        self.assertNotIn("profileId", public_article()["authorProfile"])
        response = self.api.patch(settings_url, {"publicProfile": True}, format="json")
        self.assertEqual(response.json()["privacy"], {**default, "publicProfile": True})
        profile_id = public_article()["authorProfile"]["profileId"]
        profile_path = f"/api/profiles/{profile_id}/"
        profile = self.anon.get(profile_path).json()["profile"]
        self.assertEqual(set(profile), {"name", "bio", "avatarUrl", "posts"})
        self.assertEqual(profile["bio"], "我的简介")
        self.assertEqual(profile["posts"], [{"id": str(item.public_entry_id), "title": item.title}])

        self.assertEqual(self.api.patch(settings_url, {"showPostAuthor": False}, format="json").status_code, 200)
        anonymous = {"name": "匿名用户", "avatarUrl": "", "anonymous": True}
        article = public_article()
        self.assertEqual(article["authorProfile"], anonymous)
        self.assertEqual(article["contributor"], "匿名用户")
        self.assertEqual(self.anon.get(profile_path).json()["profile"]["posts"], [])
        for url in comment_paths:
            self.assertEqual(self.anon.get(url).json()["comments"][0]["authorProfile"]["profileId"], profile_id)

        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION=f"Bearer {create_session(self.other)}")
        self.assertEqual(other.get(settings_url).json()["privacy"], default)
        self.assertEqual(self.api.patch(settings_url, {"showCommentAuthor": False, "publicProfile": False},
                                        format="json").status_code, 200)
        self.assertEqual(self.anon.get(profile_path).status_code, 404)
        self.assertEqual(other.get(profile_path).status_code, 404)
        for url in comment_paths:
            response = self.api.post(url, {"body": "新的评论", "request_id": str(uuid4())}, format="json")
            self.assertEqual(response.json()["comment"]["authorProfile"], anonymous)
            comments = other.get(url).json()["comments"]
            self.assertEqual([comment["body"] for comment in comments], ["新的评论", "早期评论"])
            self.assertTrue(all(comment["authorProfile"] == anonymous and comment["author"] == "匿名用户" for comment in comments))
        self.assertEqual(self.api.get(settings_url).json()["privacy"],
                         {"showPostAuthor": False, "showCommentAuthor": False, "publicProfile": False})
        self.assertEqual(self.api.get("/api/accounts/me/").json()["user"]["nickname"], "校园漫步者")

    def test_profile_updates_existing_submission_identity_and_serves_cleaned_avatar(self):
        endpoint = "/api/accounts/me/"
        item = self.submit()
        review_submission(item.pk, item.revision, "approved", "", self.admin)
        self.assertEqual(self.anon.patch(endpoint, {"nickname": "访客"}, format="json").status_code, 401)
        self.assertEqual(self.api.get(endpoint).json()["user"]["nickname"], "")
        result = self.api.patch(endpoint, {"nickname": "  港大漫游者  ", "bio": "喜欢校园散步", "avatar": photo()}, format="multipart")
        self.assertEqual(result.status_code, 200, result.content)
        user = result.json()["user"]
        self.assertEqual((user["username"], user["nickname"], user["bio"]), ("student_one", "港大漫游者", "喜欢校园散步"))
        avatar_path = urlsplit(user["avatarUrl"]).path
        image = self.anon.get(avatar_path)
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["Content-Type"], "image/jpeg")
        with Image.open(io.BytesIO(b"".join(image.streaming_content))) as cleaned:
            self.assertEqual(cleaned.size, (256, 256))
            self.assertFalse(cleaned.getexif())
        expected = {"name": user["nickname"], "avatarUrl": user["avatarUrl"]}
        self.assertEqual(self.api.get(f"/api/submissions/{item.pk}/").json()["submission"]["authorProfile"], expected)
        article = next(article for article in self.anon.get("/api/guide/").json()["articles"] if article["title"] == item.title)
        self.assertEqual(article["authorProfile"], expected)
        self.assertEqual(self.api.patch(endpoint, {"nickname": "x" * 33}, format="json").status_code, 400)
        with self.captureOnCommitCallbacks(execute=True):
            updated = self.api.patch(endpoint, {"remove_avatar": True}, format="json").json()["user"]
        self.assertEqual(updated["avatarUrl"], "")
        self.assertEqual(updated["nickname"], "港大漫游者")
        self.assertEqual(self.anon.get(avatar_path).status_code, 404)
        self.assertFalse(list((Path(self.directory.name) / "avatars").glob("*.jpg")))

    def test_registration_normalizes_names_hashes_password_and_never_grants_staff(self):
        response = self.anon.post("/api/accounts/register/", {"username": "  New_Student  ", "password": "Study-river-2948", "is_staff": True}, format="json")
        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(username="new_student")
        self.assertTrue(user.check_password("Study-river-2948"))
        self.assertFalse(user.is_staff)
        self.assertNotIn("password", response.json())
        self.assertFalse(MobileSession.objects.filter(token_hash=response.json()["token"]).exists())
        self.assertEqual(self.anon.post("/api/accounts/register/", {"username": "NEW_STUDENT", "password": "Study-river-2948"}, format="json").status_code, 400)

    def test_invalid_registration_and_login(self):
        count = get_user_model().objects.count()
        for data in [{"username": "newuser", "password": "12345678"}, {"username": "bad space", "password": "Study-river-2948"}, []]:
            self.assertEqual(self.anon.post("/api/accounts/register/", data, format="json").status_code, 400)
        self.assertEqual(get_user_model().objects.count(), count)
        self.assertEqual(self.anon.post("/api/accounts/login/", {"username": "student_one", "password": "wrong"}, format="json").status_code, 401)

    def test_login_logout_revokes_only_current_session_and_expiry(self):
        result = self.anon.post("/api/accounts/login/", {"username": "STUDENT_ONE", "password": "Campus-check-5296"}, format="json")
        self.assertEqual(result.status_code, 200)
        other_device = APIClient()
        other_device.credentials(HTTP_AUTHORIZATION="Bearer " + result.json()["token"])
        self.assertEqual(self.api.post("/api/accounts/logout/").status_code, 204)
        self.assertEqual(self.api.get("/api/accounts/me/").status_code, 401)
        self.assertEqual(other_device.get("/api/accounts/me/").status_code, 200)
        MobileSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(other_device.get("/api/accounts/me/").status_code, 401)

    def test_auth_rate_limit(self):
        for index in range(12):
            self.assertEqual(self.anon.post("/api/accounts/login/", {"username": "missing", "password": "wrong"}, format="json").status_code, 401)
        self.assertEqual(self.anon.post("/api/accounts/login/", {"username": "missing", "password": "wrong"}, format="json").status_code, 429)

    def test_anonymous_reads_guide_but_cannot_read_or_submit_private_content(self):
        self.assertEqual(self.anon.get("/api/guide/").status_code, 200)
        self.assertEqual(self.anon.get("/api/submissions/").status_code, 401)
        self.assertEqual(self.anon.post("/api/submissions/", self.payload, format="json").status_code, 401)

    def test_pending_content_is_owner_only_and_write_fields_are_controlled(self):
        item = self.submit(status="approved", author=self.other.pk, reviewer=self.other.pk)
        self.assertEqual(item.author, self.owner)
        self.assertEqual(item.status, "pending")
        self.assertIsNone(item.reviewer)
        self.assertNotContains(self.anon.get("/api/guide/"), item.title)
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + create_session(self.other))
        self.assertEqual(self.api.get("/api/submissions/").json()["count"], 0)
        self.assertEqual(self.api.get(f"/api/submissions/{item.pk}/").status_code, 404)
        self.assertEqual(self.api.patch(f"/api/submissions/{item.pk}/", self.payload, format="json").status_code, 404)

    def test_retry_is_idempotent_and_different_payload_conflicts(self):
        item = self.submit()
        retry = self.api.post("/api/submissions/", self.payload, format="json")
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["submission"]["id"], str(item.pk))
        self.assertEqual(Submission.objects.count(), 1)
        changed = self.api.post("/api/submissions/", {**self.payload, "body": "与刚才收到的投稿内容不同，请检查。"}, format="json")
        self.assertEqual(changed.status_code, 409)

    def test_required_fields_and_safe_links(self):
        for patch in [{"kind": "group"}, {"kind": "place"}, {"kind": "route"}, {"external_url": "javascript:alert(1)"}, {"external_url": "ftp://example.com/test"}, {"request_key": ""}, {"body": "短"}]:
            self.assertEqual(self.api.post("/api/submissions/", {**self.payload, **patch}, format="json").status_code, 400)
        self.assertFalse(Submission.objects.exists())

    def test_uploaded_image_is_sanitized_and_private_until_approved(self):
        item = self.submit(image=photo())
        with Image.open(item.image.path) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertLessEqual(max(image.size), 1600)
            self.assertFalse(image.getexif())
        path = f"/api/images/{item.pk}/"
        self.assertEqual(self.anon.get(path).status_code, 404)
        owner_image = self.api.get(path)
        self.assertEqual(owner_image.status_code, 200)
        self.assertTrue(b"".join(owner_image.streaming_content))
        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION="Bearer " + create_session(self.other))
        self.assertEqual(other.get(path).status_code, 404)
        admin = Client()
        admin.force_login(self.admin)
        admin_image = admin.get(path)
        self.assertEqual(admin_image.status_code, 200)
        self.assertTrue(b"".join(admin_image.streaming_content))
        self.assertEqual(self.anon.get("/media/" + item.image.name).status_code, 404)
        reviewed = review_submission(item.pk, 1, "approved", "已核实", self.admin)
        public = self.anon.get(path)
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public["Content-Type"], "image/jpeg")
        self.assertIn("no-store", public["Cache-Control"])
        self.assertTrue(b"".join(public.streaming_content))
        self.assertContains(self.anon.get("/api/guide/"), f"/api/images/{item.pk}/")
        published = [entry for category in self.anon.get("/api/guide/").json()["categories"] for entry in category["entries"] if entry["id"] == str(reviewed.public_entry_id)]
        self.assertEqual(len(published), 1)
        self.assertTrue(published[0]["isCommunity"])
        reviewed.public_entry.published = False
        reviewed.public_entry.save()
        self.assertEqual(self.anon.get(path).status_code, 404)

    def test_invalid_and_oversized_uploads_leave_no_files(self):
        for upload in [SimpleUploadedFile("fake.jpg", b"not an image", "image/jpeg"), SimpleUploadedFile("big.jpg", b"x" * (5 * 1024 * 1024 + 1), "image/jpeg")]:
            response = self.api.post("/api/submissions/", {**self.payload, "image": upload}, format="multipart")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(list(Path(self.directory.name).rglob("*.jpg")), [])

    def test_admin_form_approval_publishes_once(self):
        item = self.submit()
        self.client.force_login(self.admin)
        path = f"/admin/community/submission/{item.pk}/change/"
        self.assertEqual(self.client.get(path).status_code, 200)
        response = self.client.post(path, {"decision": "approved", "review_version": 1, "review_note": "已核实", "_save": "保存"})
        self.assertEqual(response.status_code, 302)
        item.refresh_from_db()
        self.assertEqual(item.status, "approved")
        self.assertEqual(item.reviewer, self.admin)
        self.assertTrue(item.public_entry.published)
        self.assertContains(self.anon.get("/api/guide/"), item.title)
        self.assertEqual(self.client.post(path, {"decision": "approved", "review_version": 1, "review_note": "", "_save": "保存"}).status_code, 302)
        self.assertEqual(GuidePost.objects.filter(title=item.title).count(), 1)
        self.assertEqual(self.api.patch(f"/api/submissions/{item.pk}/", {**self.payload, "revision": 2}, format="json").status_code, 409)

    def test_changes_require_feedback_and_owner_can_resubmit(self):
        item = self.submit(image=photo())
        old_file = item.image.path
        with self.assertRaises(ReviewConflict):
            review_submission(item.pk, 1, "changes_requested", "", self.admin)
        item = review_submission(item.pk, 1, "changes_requested", "请补充价格信息。", self.admin)
        self.assertEqual(item.revision, 2)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.api.patch(f"/api/submissions/{item.pk}/", {**self.payload, "revision": 2, "body": "更新：午餐价格为示例数字，内容用于验证。", "remove_image": True}, format="json")
        self.assertEqual(response.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.status, "pending")
        self.assertEqual(item.review_note, "")
        self.assertEqual(item.revision, 3)
        self.assertFalse(Path(old_file).exists())
        self.assertEqual(self.api.patch(f"/api/submissions/{item.pk}/", {**self.payload, "revision": 2}, format="json").status_code, 409)
        with self.assertRaises(ReviewConflict):
            review_submission(item.pk, 1, "approved", "", self.admin)
        self.assertNotContains(self.anon.get("/api/guide/"), item.title)
        review_submission(item.pk, 3, "approved", "通过", self.admin)
        self.assertContains(self.anon.get("/api/guide/"), item.title)

    def test_stale_admin_form_cannot_approve_resubmitted_content(self):
        item = self.submit()
        review_submission(item.pk, 1, "changes_requested", "请补充说明", self.admin)
        self.api.patch(f"/api/submissions/{item.pk}/", {**self.payload, "revision": 2}, format="json")
        self.client.force_login(self.admin)
        response = self.client.post(f"/admin/community/submission/{item.pk}/change/", {"decision": "approved", "review_version": 1, "review_note": "", "_save": "保存"})
        self.assertEqual(response.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.status, "pending")
        self.assertIsNone(item.public_entry)

    def test_regular_user_cannot_review_and_corrections_publish_as_tips(self):
        item = self.submit(kind="route", location="示例入口至图书馆")
        with self.assertRaises(ReviewConflict):
            review_submission(item.pk, 1, "approved", "", self.owner)
        item = review_submission(item.pk, 1, "approved", "", self.admin)
        self.assertEqual(item.public_entry.post.category_id, "tips")
        self.assertIn(item.location, item.public_entry.post.body)

    def test_private_history_is_paginated_and_read_does_not_consume_submit_limit(self):
        Submission.objects.bulk_create([Submission(author=self.owner, kind="food", title=f"投稿{i}", body="正文", request_key=f"history_key_{i}", content_hash="x") for i in range(23)])
        first = self.api.get("/api/submissions/").json()
        self.assertEqual(first["count"], 23)
        self.assertEqual(len(first["submissions"]), 20)
        self.assertEqual(first["nextPage"], 2)
        second = self.api.get("/api/submissions/?page=2").json()
        self.assertEqual(len(second["submissions"]), 3)
        self.assertIsNone(second["nextPage"])
        for _ in range(15):
            self.assertEqual(self.api.get("/api/submissions/").status_code, 200)
        self.submit()
