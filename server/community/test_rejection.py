from .models import InboxMessage, Submission
from .services import ReviewConflict, review_submission
from .tests import CommunityFixture


class RejectionTests(CommunityFixture):
    def test_admin_can_reject_and_author_receives_reason_without_publication(self):
        item = self.submit()
        self.client.force_login(self.admin)
        path = f"/admin/community/submission/{item.pk}/change/"
        self.assertContains(self.client.get(path), 'value="rejected"')
        response = self.client.post(path, {"decision": "rejected", "review_version": 1,
            "review_note": "内容与校园无关。", "_save": "提交审核结果"})
        self.assertEqual(response.status_code, 302)
        item.refresh_from_db()
        self.assertEqual((item.status, item.review_note, item.reviewer, item.revision),
            ("rejected", "内容与校园无关。", self.admin, 2))
        self.assertIsNotNone(item.reviewed_at)
        self.assertIsNone(item.public_entry_id)
        self.assertNotContains(self.anon.get("/api/guide/"), item.title)
        notice = self.api.get("/api/inbox/").json()["messages"][0]
        self.assertEqual((notice["reviewStatus"], notice["reviewNote"]), ("rejected", "内容与校园无关。"))
        self.assertEqual(self.api.get(f"/api/submissions/{item.pk}/").json()["submission"]["status"], "rejected")
        self.assertContains(self.client.get('/admin/community/submission/?status__exact=rejected'), item.title)

    def test_rejection_requires_reason_in_form_and_service(self):
        item = self.submit()
        self.client.force_login(self.admin)
        response = self.client.post(f"/admin/community/submission/{item.pk}/change/", {
            "decision": "rejected", "review_version": 1, "review_note": "  ", "_save": "保存"})
        self.assertContains(response, "请写明拒绝原因。")
        with self.assertRaises(ReviewConflict):
            review_submission(item.pk, 1, "rejected", "  ", self.admin)
        item.refresh_from_db()
        self.assertEqual(item.status, "pending")
        self.assertFalse(InboxMessage.objects.filter(submission=item).exists())

    def test_rejected_submission_cannot_be_resubmitted_or_reviewed_again(self):
        item = review_submission(self.submit().pk, 1, "rejected", "重复投稿。", self.admin)
        response = self.api.patch(f"/api/submissions/{item.pk}/", {**self.payload, "revision": 2}, format="json")
        self.assertEqual(response.status_code, 409)
        for decision in ("approved", "changes_requested", "rejected"):
            with self.assertRaises(ReviewConflict):
                review_submission(item.pk, 2, decision, "再次审核", self.admin)
        self.assertEqual(InboxMessage.objects.filter(submission=item).count(), 1)

    def test_stale_or_nonadmin_rejection_is_blocked(self):
        item = self.submit()
        for revision, reviewer in ((0, self.admin), (1, self.owner)):
            with self.assertRaises(ReviewConflict):
                review_submission(item.pk, revision, "rejected", "拒绝原因", reviewer)
        item.refresh_from_db()
        self.assertEqual(item.status, "pending")

    def test_rejecting_edit_preserves_live_content_and_allows_a_new_edit(self):
        original = review_submission(self.submit().pk, 1, "approved", "", self.admin)
        publication = original.public_entry
        body, version = publication.post.body, publication.updated_at
        payload = {**self.payload, "title": "不合适的修改版本", "request_key": "rejected_edit_001", "base_version": version.isoformat()}
        response = self.api.post(f"/api/submissions/{original.pk}/edits/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        edit_id = response.json()["submission"]["id"]
        review_submission(edit_id, 1, "rejected", "修改内容不适用。", self.admin)
        publication.refresh_from_db()
        self.assertEqual((publication.post.body, publication.current_submission_id, publication.updated_at, publication.published),
            (body, original.pk, version, True))
        response = self.api.post(f"/api/submissions/{original.pk}/edits/", {**payload, "request_key": "after_rejection_002"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Submission.objects.filter(edit_of=publication, status="pending").count(), 1)
