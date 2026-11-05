import io

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import default_storage
from django.test import TestCase, override_settings
from PIL import Image

from .models import MediaQuota, StoredMedia, Submission
from .services import review_submission
from .storage import DatabaseStorage, MediaQuotaExceeded
from .tests import CommunityFixture

DATABASE_MEDIA = {"default": {"BACKEND": "community.storage.DatabaseStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}


@override_settings(STORAGES=DATABASE_MEDIA, MEDIA_DATABASE_MAX_BYTES=10)
class DatabaseMediaTests(TestCase):
    def test_quota_rejects_without_orphans_and_delete_reclaims_capacity(self):
        storage = DatabaseStorage()
        first = storage.save("contributions/one.jpg", ContentFile(b"123456"))
        with self.assertRaises(MediaQuotaExceeded):
            storage.save("contributions/two.jpg", ContentFile(b"12345"))
        self.assertEqual(StoredMedia.objects.count(), 1)
        self.assertEqual(MediaQuota.objects.get(pk=1).used_bytes, 6)
        storage.delete(first)
        storage.delete(first)
        self.assertEqual(MediaQuota.objects.get(pk=1).used_bytes, 0)
        replacement = storage.save("contributions/two.jpg", ContentFile(b"abcdefghij"))
        with storage.open(replacement) as image:
            self.assertEqual(image.read(), b"abcdefghij")
        self.assertEqual(storage.listdir(""), (["contributions"], []))
        with self.assertRaises(ValueError):
            storage.url(replacement)

    def test_paths_and_missing_objects_do_not_expose_filesystem(self):
        storage = DatabaseStorage()
        for name in ["../secret", "/absolute", "C:\\secret"]:
            with self.assertRaises(SuspiciousFileOperation):
                storage.exists(name)
        with self.assertRaises(FileNotFoundError):
            storage.open("missing.jpg")


@override_settings(STORAGES=DATABASE_MEDIA)
class DatabaseMediaAPITests(CommunityFixture):
    def photo(self):
        data = io.BytesIO()
        Image.new("RGB", (80, 40), "green").save(data, "PNG")
        return SimpleUploadedFile("guide.png", data.getvalue(), content_type="image/png")

    def test_image_permissions_still_apply_to_database_media(self):
        item = self.submit(image=self.photo())
        self.assertEqual(self.anon.get(f"/api/images/{item.pk}/").status_code, 404)
        self.assertEqual(self.api.get(f"/api/images/{item.pk}/").status_code, 200)
        review_submission(item.pk, item.revision, Submission.Status.APPROVED, "", self.admin)
        response = self.anon.get(f"/api/images/{item.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(b"".join(response.streaming_content).startswith(b"\xff\xd8"))
        self.assertEqual(StoredMedia.objects.count(), 1)

    @override_settings(MEDIA_DATABASE_MAX_BYTES=1)
    def test_full_capacity_returns_actionable_error_without_submission(self):
        response = self.api.post("/api/submissions/", {**self.payload, "image": self.photo()}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("图片空间已满", str(response.data))
        self.assertFalse(Submission.objects.exists())
        self.assertFalse(StoredMedia.objects.exists())
