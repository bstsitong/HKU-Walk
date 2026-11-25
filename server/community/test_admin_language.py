import ast
import gettext
import re
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import translation

from .models import Submission


class AdminLanguageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = get_user_model().objects.create_superuser("language-admin", password="test-only-password")
        cls.item = Submission.objects.create(author=cls.admin, kind="new_place", title="原始地点 CPD-3.04",
            body="原始介绍，不应被改写。", request_key="language-test", content_hash="language-test",
            map_data={"category": "study", "x": 12, "y": 34, "mapVersion": 2})

    def switch(self, language, next_url="/admin/"):
        return self.client.post("/admin/set-language/", {"language": language, "next": next_url})

    def test_login_and_authenticated_pages_follow_language_and_keep_location(self):
        expected = {
            "en": ("HKU Walk administration", "Submission review", "Chinese name", "Upload Word document"),
            "zh-hant": ("港大漫遊管理後台", "投稿審核", "中文名稱", "上傳 Word 文檔"),
            "zh-hans": ("港大漫游管理后台", "投稿审核", "中文名称", "上传 Word 文档"),
        }
        for language, (header, review, field, upload) in expected.items():
            with self.subTest(language=language):
                self.client.logout()
                next_url = "/admin/community/submission/?status__exact=pending&q=CPD"
                response = self.switch(language, next_url)
                self.assertRedirects(response, next_url, fetch_redirect_response=False)
                self.assertEqual(response.cookies[settings.LANGUAGE_COOKIE_NAME].value, language)
                self.assertEqual(response.cookies[settings.LANGUAGE_COOKIE_NAME]["path"], "/admin/")
                login = self.client.get("/admin/login/")
                self.assertContains(login, header)
                self.assertContains(login, 'id="admin-language"', count=1)
                self.client.force_login(self.admin)
                for path, label in [("/admin/", review), ("/admin/guide/campusplace/add/", field),
                                    ("/admin/guide/knowledgedocument/add/", upload),
                                    (next_url, review)]:
                    page = self.client.get(path)
                    self.assertContains(page, label)
                    self.assertContains(page, 'id="admin-language"', count=1)
                    self.assertEqual(page.headers["Content-Language"], language)
                detail = self.client.get(f"/admin/community/submission/{self.item.pk}/change/")
                self.assertContains(detail, self.item.title)
                self.assertContains(detail, self.item.body)
        self.item.refresh_from_db()
        self.assertEqual(self.item.title, "原始地点 CPD-3.04")

    def test_english_review_errors_and_rejection_preserve_authored_feedback(self):
        self.client.force_login(self.admin)
        self.switch("en")
        path = f"/admin/community/submission/{self.item.pk}/change/"
        data = {"decision": "rejected", "review_version": 1, "review_note": "", "_save": "Submit"}
        self.assertContains(self.client.post(path, data), "Explain why this submission is rejected.")
        response = self.client.post(path, {**data, "review_note": "请核实 CPD-3.04。"})
        self.assertEqual(response.status_code, 302)
        self.item.refresh_from_db()
        self.assertEqual((self.item.status, self.item.review_note), ("rejected", "请核实 CPD-3.04。"))

    def test_switch_requires_csrf_and_rejects_unsupported_languages_and_external_redirects(self):
        csrf_client = Client(enforce_csrf_checks=True)
        self.assertEqual(csrf_client.post("/admin/set-language/", {"language": "en"}).status_code, 403)
        self.assertNotIn(settings.LANGUAGE_COOKIE_NAME, self.client.get("/admin/set-language/?language=en").cookies)
        self.assertNotIn(settings.LANGUAGE_COOKIE_NAME, self.switch("invalid").cookies)
        self.assertEqual(self.switch("en", "https://example.com/away")["Location"], "/")

    def test_admin_language_does_not_leak_into_mobile_api(self):
        self.switch("en")
        self.client.get("/admin/login/")
        self.assertEqual(translation.get_language(), "en")
        self.client.get("/api/health/", HTTP_ACCEPT_LANGUAGE="en")
        self.assertEqual(translation.get_language(), settings.LANGUAGE_CODE)

    def test_catalogs_cover_all_marked_project_messages(self):
        sources = set()
        for path in Path(settings.BASE_DIR).rglob("*.py"):
            if "migrations" in path.parts:
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"_", "gettext"}
                        and node.args and isinstance(node.args[0], ast.Constant)):
                    sources.add(node.args[0].value)
        for path in list((settings.BASE_DIR / "community/templates/admin").rglob("*.html")) + list((settings.BASE_DIR / "templates/admin").rglob("*.html")):
            sources.update(re.findall(r'{% translate "([^"]+)" %}', path.read_text(encoding="utf-8")))
        sources.add("第 %(step)s 步配图")
        for language in ("en", "zh_Hant"):
            with (settings.BASE_DIR / "locale" / language / "LC_MESSAGES/django.mo").open("rb") as file:
                catalog = gettext.GNUTranslations(file)._catalog
            self.assertFalse(sources - catalog.keys(), f"Missing {language} messages")
            for source in sources:
                self.assertTrue(catalog[source])
                self.assertEqual(set(re.findall(r"%\([^)]+\)s", source)),
                                 set(re.findall(r"%\([^)]+\)s", catalog[source])))
