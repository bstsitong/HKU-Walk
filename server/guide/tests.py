from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.exceptions import ValidationError
from django.test import Client, TestCase

from .models import GuideCategory, GuideEntry

class GuideTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_guide", verbosity=0)
        cls.admin_user = get_user_model().objects.create_superuser("testadmin", password="Test-pass-for-local-checks")

    def test_public_read_contains_four_categories_and_live_edits(self):
        self.assertEqual(len(self.client.get("/api/guide/").json()["categories"]), 4)
        entry = GuideEntry.objects.get(key="tips-1")
        entry.body = "管理员更新后的入学安排"
        entry.save()
        content = self.client.get("/api/guide/")
        self.assertContains(content, "管理员更新后的入学安排")
        self.assertIn("no-store", content.headers["Cache-Control"])

    def test_unpublished_content_is_private(self):
        entry = GuideEntry.objects.get(key="tips-1")
        entry.published = False
        entry.save()
        self.assertNotContains(self.client.get("/api/guide/"), entry.body)

    def test_public_endpoint_rejects_writes_and_admin_requires_login(self):
        self.assertEqual(self.client.post("/api/guide/", {}).status_code, 405)
        response = self.client.get("/admin/guide/guideentry/")
        self.assertRedirects(response, "/admin/login/?next=/admin/guide/guideentry/")

    def test_admin_can_create_edit_and_delete(self):
        self.client.force_login(self.admin_user)
        values = {
            "key": "admin-roundtrip", "category": "tips", "title": "后台测试",
            "body": "创建的正文", "external_url": "", "image_url": "",
            "published": "on", "sort_order": "0", "_save": "保存",
        }
        response = self.client.post("/admin/guide/guideentry/add/", values)
        self.assertEqual(response.status_code, 302)
        entry = GuideEntry.objects.get(title="后台测试")
        values["body"] = "后台编辑后的正文"
        self.assertEqual(self.client.post(f"/admin/guide/guideentry/{entry.pk}/change/", values).status_code, 302)
        self.assertContains(self.client.get("/api/guide/"), "后台编辑后的正文")
        self.assertEqual(self.client.post(f"/admin/guide/guideentry/{entry.pk}/delete/", {"post": "yes"}).status_code, 302)
        self.assertFalse(GuideEntry.objects.filter(pk=entry.pk).exists())

    def test_seed_preserves_edits_and_does_not_duplicate(self):
        entry = GuideEntry.objects.get(key="tips-1")
        entry.title = "保留管理员修改"
        entry.save()
        count = GuideEntry.objects.count()
        call_command("seed_guide", verbosity=0)
        self.assertEqual(GuideEntry.objects.count(), count)
        entry.refresh_from_db()
        self.assertEqual(entry.title, "保留管理员修改")

    def test_admin_csrf_and_url_validation(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.admin_user)
        self.assertEqual(client.post("/admin/guide/guideentry/add/", {}).status_code, 403)
        entry = GuideEntry.objects.get(key="links-1")
        entry.external_url = "javascript:alert(1)"
        with self.assertRaises(ValidationError):
            entry.full_clean()
