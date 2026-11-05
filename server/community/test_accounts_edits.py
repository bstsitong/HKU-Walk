import hashlib
from django.contrib.auth import get_user_model

from .accounts import code_digest, issue_recovery_code
from .authentication import create_session
from .models import MobileSession, RecoveryCredential, Submission
from .services import ReviewConflict, review_submission
from .tests import CommunityFixture, photo
from guide.models import GuideEntry


class AccountSecurityTests(CommunityFixture):
    def test_password_change_checks_current_password_and_revokes_other_devices(self):
        second = create_session(self.owner)
        endpoint = "/api/accounts/change-password/"
        wrong = self.api.post(endpoint, {"current_password": "wrong", "new_password": "Fresh-river-5216"}, format="json")
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(self.api.post(endpoint, {"current_password": "Campus-check-5296", "new_password": "12345678"}, format="json").status_code, 400)
        self.assertEqual(self.api.post(endpoint, {"current_password": "Campus-check-5296", "new_password": "Campus-check-5296"}, format="json").status_code, 400)
        result = self.api.post(endpoint, {"current_password": "Campus-check-5296", "new_password": "Fresh-river-5216"}, format="json")
        self.assertEqual(result.status_code, 200)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.check_password("Fresh-river-5216"))
        self.assertFalse(MobileSession.objects.filter(token_hash=hashlib.sha256(second.encode()).hexdigest()).exists())
        self.assertEqual(self.api.get("/api/accounts/me/").status_code, 401)
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + result.json()["token"])
        self.assertEqual(self.api.get("/api/accounts/me/").status_code, 200)

    def test_registered_recovery_code_is_not_stored_or_readable_again(self):
        result = self.anon.post("/api/accounts/register/", {"username": "recover_me", "password": "Study-cloud-6942"}, format="json")
        self.assertEqual(result.status_code, 201)
        code = result.json()["recoveryCode"]
        user = get_user_model().objects.get(username="recover_me")
        self.assertEqual(user.recovery_credential.token_hash, code_digest(code))
        self.assertNotEqual(user.recovery_credential.token_hash, code)
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + result.json()["token"])
        me = self.api.get("/api/accounts/me/").json()
        self.assertTrue(me["user"]["hasRecoveryCode"])
        self.assertNotIn("recoveryCode", me)

    def test_recovery_finds_username_rotates_code_and_revokes_old_sessions(self):
        code = issue_recovery_code(self.owner)
        result = self.anon.post("/api/accounts/recover/", {"recovery_code": code.lower().replace("-", " "), "new_password": "Recovery-stream-6712"}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["user"]["username"], self.owner.username)
        self.assertNotEqual(result.json()["recoveryCode"], code)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.check_password("Recovery-stream-6712"))
        self.assertEqual(self.api.get("/api/accounts/me/").status_code, 401)
        reuse = self.anon.post("/api/accounts/recover/", {"recovery_code": code, "new_password": "Second-stream-6812"}, format="json")
        self.assertEqual(reuse.status_code, 400)

    def test_invalid_or_weak_recovery_does_not_consume_valid_code(self):
        code = issue_recovery_code(self.owner)
        old_hash = self.owner.password
        self.assertEqual(self.anon.post("/api/accounts/recover/", {"recovery_code": "invalid", "new_password": "Other-stream-6812"}, format="json").status_code, 400)
        self.assertEqual(self.anon.post("/api/accounts/recover/", {"recovery_code": code, "new_password": "12345678"}, format="json").status_code, 400)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.password, old_hash)
        self.assertEqual(self.owner.recovery_credential.token_hash, code_digest(code))

    def test_recovery_rotation_requires_password_and_keeps_existing_login(self):
        original = issue_recovery_code(self.owner)
        self.assertEqual(self.anon.post("/api/accounts/recovery-code/", {"current_password": "Campus-check-5296"}, format="json").status_code, 401)
        self.assertEqual(self.api.post("/api/accounts/recovery-code/", {"current_password": "wrong"}, format="json").status_code, 400)
        result = self.api.post("/api/accounts/recovery-code/", {"current_password": "Campus-check-5296"}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertNotEqual(original, result.json()["recoveryCode"])
        self.assertEqual(self.api.get("/api/accounts/me/").status_code, 200)
        self.assertFalse(RecoveryCredential.objects.filter(token_hash=code_digest(original)).exists())

    def test_inactive_account_cannot_be_recovered(self):
        code = issue_recovery_code(self.owner)
        self.owner.is_active = False
        self.owner.save()
        self.assertEqual(self.anon.post("/api/accounts/recover/", {"recovery_code": code, "new_password": "Other-stream-6812"}, format="json").status_code, 400)

    def test_recovery_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.anon.post("/api/accounts/recover/", {"recovery_code": "invalid", "new_password": "Other-stream-6812"}, format="json").status_code, 400)
        self.assertEqual(self.anon.post("/api/accounts/recover/", {"recovery_code": "invalid", "new_password": "Other-stream-6812"}, format="json").status_code, 429)


class PublishedEditTests(CommunityFixture):
    def published(self, image=False):
        item = self.submit(**({"image": photo()} if image else {}))
        return review_submission(item.pk, 1, "approved", "", self.admin)

    def propose(self, source, key="edit_request_001", **patch):
        data = {**self.payload, "title": "更新后的校园美食信息", "request_key": key,
            "base_version": source.public_entry.updated_at.isoformat(), **patch}
        response = self.api.post(f"/api/submissions/{source.pk}/edits/", data,
            format="multipart" if "image" in data else "json")
        self.assertEqual(response.status_code, 201, response.content)
        return Submission.objects.get(pk=response.json()["submission"]["id"])

    def test_pending_edit_does_not_change_live_content_and_approval_replaces_same_entry(self):
        original = self.published()
        edit = self.propose(original)
        self.assertTrue(edit.edit_of_id)
        self.assertNotContains(self.anon.get("/api/guide/"), edit.title)
        self.assertContains(self.anon.get("/api/guide/"), original.title)
        before = GuideEntry.objects.count()
        edit = review_submission(edit.pk, 1, "approved", "更新已核实", self.admin)
        self.assertEqual(edit.public_entry_id, original.public_entry_id)
        self.assertEqual(edit.public_entry.current_submission_id, edit.pk)
        self.assertEqual(GuideEntry.objects.count(), before)
        self.assertContains(self.anon.get("/api/guide/"), edit.title)
        self.assertNotContains(self.anon.get("/api/guide/"), original.title)
        original.refresh_from_db()
        self.assertEqual(original.title, self.payload["title"])

    def test_only_owner_of_approved_published_content_can_propose(self):
        pending = self.submit()
        self.assertEqual(self.api.post(f"/api/submissions/{pending.pk}/edits/", self.payload, format="json").status_code, 409)
        original = review_submission(pending.pk, 1, "approved", "", self.admin)
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + create_session(self.other))
        self.assertEqual(self.api.post(f"/api/submissions/{original.pk}/edits/", self.payload, format="json").status_code, 404)
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + self.token)
        original.public_entry.published = False
        original.public_entry.save()
        self.assertEqual(self.api.post(f"/api/submissions/{original.pk}/edits/", self.payload, format="json").status_code, 409)

    def test_only_one_open_edit_and_retry_does_not_duplicate(self):
        original = self.published()
        edit = self.propose(original)
        data = {**self.payload, "title": edit.title, "request_key": "edit_request_001", "base_version": original.public_entry.updated_at.isoformat()}
        self.assertEqual(self.api.post(f"/api/submissions/{original.pk}/edits/", data, format="json").status_code, 200)
        data["request_key"] = "another_edit_001"
        self.assertEqual(self.api.post(f"/api/submissions/{original.pk}/edits/", data, format="json").status_code, 409)
        self.assertEqual(Submission.objects.filter(edit_of=original.public_entry).count(), 1)

    def test_changed_public_version_requires_refresh_and_stale_approval_rolls_back(self):
        original = self.published()
        edit = self.propose(original)
        entry = original.public_entry
        old_version = entry.updated_at.isoformat()
        entry.body = "管理员刚刚更新了公开内容，需先核对。"
        entry.save()
        with self.assertRaises(ReviewConflict):
            review_submission(edit.pk, 1, "approved", "", self.admin)
        edit.refresh_from_db()
        self.assertEqual(edit.status, "pending")
        self.assertEqual(self.api.post(f"/api/submissions/{original.pk}/edits/", {**self.payload, "base_version": old_version}, format="json").status_code, 409)
        edit = review_submission(edit.pk, 1, "changes_requested", "请核对管理员补充的信息。", self.admin)
        response = self.api.patch(f"/api/submissions/{edit.pk}/", {**self.payload, "revision": edit.revision,
            "base_version": entry.updated_at.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        edit.refresh_from_db()
        review_submission(edit.pk, edit.revision, "approved", "", self.admin)

    def test_shared_image_retained_on_edit_resubmit_and_old_revision_image_stops_being_public(self):
        original = self.published(image=True)
        old_file = original.image.path
        edit = self.propose(original)
        self.assertEqual(original.image.name, edit.image.name)
        self.assertEqual(self.anon.get(f"/api/images/{edit.pk}/").status_code, 404)
        edit = review_submission(edit.pk, 1, "changes_requested", "请移除配图。", self.admin)
        with self.captureOnCommitCallbacks(execute=True):
            result = self.api.patch(f"/api/submissions/{edit.pk}/", {**self.payload, "revision": edit.revision,
                "base_version": original.public_entry.updated_at.isoformat(), "remove_image": True}, format="json")
        self.assertEqual(result.status_code, 200)
        from pathlib import Path
        self.assertTrue(Path(old_file).exists())
        public = self.anon.get(f"/api/images/{original.pk}/")
        self.assertEqual(public.status_code, 200)
        public.close()
        edit.refresh_from_db()
        review_submission(edit.pk, edit.revision, "approved", "", self.admin)
        self.assertEqual(self.anon.get(f"/api/images/{original.pk}/").status_code, 404)
        self.assertTrue(Path(old_file).exists())

    def test_approved_image_edit_publishes_new_image_and_preserves_entry_identifier(self):
        original = self.published(image=True)
        edit = self.propose(original, image=photo())
        edit = review_submission(edit.pk, 1, "approved", "", self.admin)
        self.assertEqual(edit.public_entry_id, original.public_entry_id)
        self.assertNotEqual(original.image.name, edit.image.name)
        response = self.anon.get(f"/api/images/{edit.pk}/")
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(self.anon.get(f"/api/images/{original.pk}/").status_code, 404)
        self.assertContains(self.anon.get("/api/guide/"), f"/api/images/{edit.pk}/")

    def test_admin_can_compare_and_review_published_edit(self):
        original = self.published()
        edit = self.propose(original)
        self.client.force_login(self.admin)
        path = f"/admin/community/submission/{edit.pk}/change/"
        self.assertContains(self.client.get(path), "当前公开内容")
        result = self.client.post(path, {"decision": "approved", "review_version": 1, "review_note": "资料已核实", "_save": "保存"})
        self.assertEqual(result.status_code, 302)
        original.public_entry.refresh_from_db()
        self.assertEqual(original.public_entry.title, edit.title)

    def test_kind_cannot_be_changed_in_edit(self):
        original = self.published()
        result = self.api.post(f"/api/submissions/{original.pk}/edits/", {**self.payload,
            "kind": "route", "location": "校园入口", "base_version": original.public_entry.updated_at.isoformat()}, format="json")
        self.assertEqual(result.status_code, 400)
