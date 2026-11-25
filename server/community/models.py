from django.utils.translation import gettext_lazy as _
import uuid
from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

class MobileSession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

class RecoveryCredential(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recovery_credential")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now=True)

class PersonalRecords(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True)
    collections = models.JSONField(default=dict)
    device_sequences = models.JSONField(default=dict)
    removed_bookmarks = models.JSONField(default=dict)
    cleared_history = models.JSONField(default=list)

class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    nickname = models.CharField(max_length=32, blank=True)
    bio = models.CharField(max_length=160, blank=True)
    avatar = models.FileField(upload_to="avatars/", blank=True, db_index=True)
    cover = models.FileField(upload_to="covers/", blank=True, db_default="")
    show_post_author = models.BooleanField(default=True)
    show_comment_author = models.BooleanField(default=True)
    public_id = models.UUIDField(unique=True, null=True, blank=True, editable=False)


@receiver(post_delete, sender=UserProfile)
def delete_profile_images(sender, instance, using, **kwargs):
    for photo in (instance.avatar, instance.cover):
        if photo:
            transaction.on_commit(lambda name=photo.name: default_storage.delete(name), using=using, robust=True)

class StoredMedia(models.Model):
    """Private image bytes for small, diskless deployments; never exposed by the Data API."""
    name = models.CharField(primary_key=True, max_length=255)
    content = models.BinaryField()
    size_bytes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

class MediaQuota(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    used_bytes = models.PositiveBigIntegerField(default=0)

class Submission(models.Model):
    class Kind(models.TextChoices):
        FOOD = "food", _("美食推荐")
        GROUP = "group", _("娱乐群资料")
        PLACE = "place", _("地点纠错")
        ROUTE = "route", _("路线纠错")
        NEW_PLACE = "new_place", _("新地点")
        NEW_ROUTE = "new_route", _("新路线")
        GUIDE = "guide", _("学生指南")

    class Status(models.TextChoices):
        PENDING = "pending", _("待审核")
        APPROVED = "approved", _("已通过")
        CHANGES = "changes_requested", _("需修改")
        REJECTED = "rejected", _("已拒绝")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, verbose_name=_("投稿人"))
    request_key = models.CharField(max_length=64)
    content_hash = models.CharField(max_length=64)
    kind = models.CharField(_("投稿类型"), max_length=12, choices=Kind.choices)
    title = models.CharField(_("标题"), max_length=160)
    body = models.TextField(_("正文"))
    body_blocks = models.JSONField(_("正文排版"), default=list, db_default=[], blank=True)
    map_data = models.JSONField(_("地点或路线资料"), default=dict, db_default={}, blank=True)
    location = models.CharField(_("相关地点或路线"), max_length=160, blank=True)
    external_url = models.URLField(_("相关链接"), blank=True, max_length=1000)
    image = models.FileField(upload_to="contributions/", blank=True)
    inherited_image_url = models.URLField(blank=True, max_length=1000)
    status = models.CharField(_("审核状态"), max_length=24, choices=Status.choices, default=Status.PENDING)
    review_note = models.TextField(_("审核说明"), blank=True)
    revision = models.PositiveIntegerField(default=1)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="reviewed_submissions", verbose_name=_("审核人"))
    reviewed_at = models.DateTimeField(_("审核时间"), null=True, blank=True)
    public_entry = models.ForeignKey("guide.Publication", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="contributions", verbose_name=_("公开内容"))
    edit_of = models.ForeignKey("guide.Publication", null=True, blank=True,
        on_delete=models.PROTECT, related_name="edit_requests", verbose_name=_("申请修改的内容"))
    base_entry_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(_("提交时间"), auto_now_add=True)
    updated_at = models.DateTimeField(_("更新时间"), auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["author", "request_key"], name="unique_submission_request"),
            models.UniqueConstraint(fields=["edit_of"], condition=models.Q(edit_of__isnull=False,
                status__in=["pending", "changes_requested"]), name="one_open_edit_per_entry"),
        ]
        verbose_name = _("用户投稿")
        verbose_name_plural = _("用户投稿")

    def __str__(self):
        return self.title

class SubmissionStepImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="step_images")
    step_index = models.PositiveSmallIntegerField()
    image = models.FileField(upload_to="contributions/steps/")

    class Meta:
        ordering = ["step_index"]
        constraints = [models.UniqueConstraint(fields=["submission", "step_index"], name="one_image_per_route_step")]


class SubmissionBodyImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="body_images")
    block_index = models.PositiveSmallIntegerField()
    image = models.FileField(upload_to="contributions/body/")

    class Meta:
        ordering = ["block_index"]
        constraints = [models.UniqueConstraint(fields=["submission", "block_index"], name="one_image_per_body_block")]


class InboxMessage(models.Model):
    class Kind(models.TextChoices):
        REVIEW = "review", _("审核结果")
        COMMENT = "comment", _("评论")
        REPLY = "reply", _("回复")

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="inbox_messages")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    submission = models.ForeignKey(Submission, null=True, blank=True, on_delete=models.CASCADE)
    guide_comment = models.ForeignKey("guide.GuideComment", null=True, blank=True, on_delete=models.CASCADE)
    place_comment = models.ForeignKey("guide.PlaceComment", null=True, blank=True, on_delete=models.CASCADE)
    review_status = models.CharField(max_length=24, blank=True)
    review_title = models.CharField(max_length=160, blank=True)
    review_note = models.TextField(blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["recipient", "-id"], name="inbox_recipient_latest"),
                   models.Index(fields=["recipient", "is_read"], name="inbox_recipient_unread")]
        constraints = [
            models.UniqueConstraint(fields=["recipient", "guide_comment"], name="unique_inbox_guide_comment"),
            models.UniqueConstraint(fields=["recipient", "place_comment"], name="unique_inbox_place_comment"),
            models.CheckConstraint(
                condition=(models.Q(kind="review", submission__isnull=False, guide_comment__isnull=True, place_comment__isnull=True)
                           | (models.Q(kind__in=["comment", "reply"], submission__isnull=True)
                              & (models.Q(guide_comment__isnull=False, place_comment__isnull=True)
                                 | models.Q(guide_comment__isnull=True, place_comment__isnull=False)))),
                name="one_inbox_message_target",
            ),
        ]
