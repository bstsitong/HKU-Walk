import io
import tempfile
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit

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

class CommunityTests(CommunityFixture):
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
