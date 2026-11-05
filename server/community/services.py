import hashlib
import json
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from guide.models import GuideCategory, GuideEntry
from .models import Submission
from .storage import MediaQuotaExceeded

class Conflict(APIException):
    status_code = 409
    default_detail = "内容状态已更新，请刷新后重试。"

class ReviewConflict(Exception):
    pass

def prepare_image(data):
    image = data.pop("image", None)
    try:
        return default_storage.save("contributions/" + image.name, image) if image else ""
    except MediaQuotaExceeded:
        raise ValidationError({"image": "图片空间已满，请先移除配图提交，并联系管理员清理空间。"})

def delete_unreferenced_image(name):
    if name and not Submission.objects.filter(image=name).exists():
        default_storage.delete(name)

def submit_new(user, data, edit_of=None, inherited_image="", inherited_image_url="", base_version=None):
    request_key = data.pop("request_key", "")
    if not request_key:
        raise ValidationError({"request_key": "缺少投稿编号，请重新打开投稿表单。"})
    data.pop("revision", None)
    remove_image = data.pop("remove_image", False)
    data.pop("base_version", None)
    digest = hashlib.sha256()
    scalar = {key: value for key, value in data.items() if key != "image"}
    scalar.update(edit_of=str(edit_of.pk) if edit_of else None, remove_image=remove_image,
        base_version=base_version.isoformat() if base_version else None)
    digest.update(json.dumps(scalar, sort_keys=True, ensure_ascii=False).encode())
    if data.get("image"):
        digest.update(data["image"].read())
        data["image"].seek(0)
    fingerprint = digest.hexdigest()
    existing = Submission.objects.filter(author=user, request_key=request_key).first()
    if existing:
        if existing.content_hash != fingerprint:
            raise Conflict("上一次投稿已经收到，请先查看我的投稿。")
        return existing, False
    stored = prepare_image(data)
    try:
        with transaction.atomic():
            result = Submission.objects.create(author=user, request_key=request_key, content_hash=fingerprint,
                image=stored or ("" if remove_image else inherited_image), edit_of=edit_of,
                inherited_image_url="" if stored or remove_image else inherited_image_url,
                base_entry_updated_at=base_version, **data)
        return result, True
    except IntegrityError:
        if stored:
            default_storage.delete(stored)
        existing = Submission.objects.filter(author=user, request_key=request_key).first()
        if existing and existing.content_hash == fingerprint:
            return existing, False
        raise Conflict("这条内容已有未完成的修改申请，请先在我的投稿中处理。" if edit_of else None)
    except Exception:
        if stored:
            default_storage.delete(stored)
        raise

def submit_edit(user, source, data):
    if source.author_id != user.pk or source.status != Submission.Status.APPROVED or not source.public_entry_id:
        raise Conflict("只有本人已发布的内容可以申请修改。")
    entry = GuideEntry.objects.select_related("current_submission").get(pk=source.public_entry_id)
    expected = data.get("base_version")
    if not entry.published or expected != entry.updated_at:
        raise Conflict("公开内容已更新或下线，请刷新投稿详情后再申请修改。")
    if data["kind"] != source.kind:
        raise ValidationError({"kind": "修改申请不能更换投稿类型。"})
    current = entry.current_submission
    return submit_new(user, data, edit_of=entry,
        inherited_image=current.image.name if current and current.image else "",
        inherited_image_url=entry.image_url, base_version=expected)

def resubmit(item, data):
    expected = data.pop("revision", None)
    data.pop("request_key", None)
    remove_image = data.pop("remove_image", False)
    base_version = data.pop("base_version", None)
    if item.status != Submission.Status.CHANGES or item.revision != expected:
        raise Conflict("请刷新投稿状态，只有需修改的投稿可以重新提交。")
    if item.edit_of_id:
        entry = GuideEntry.objects.get(pk=item.edit_of_id)
        if not entry.published or base_version != entry.updated_at:
            raise Conflict("原内容已更新或下线，请刷新后重新查看修改申请。")
        if data["kind"] != item.kind:
            raise ValidationError({"kind": "修改申请不能更换投稿类型。"})
        data["base_entry_updated_at"] = base_version
    stored = prepare_image(data)
    old_image = item.image.name
    image_name = stored or ("" if remove_image else old_image)
    if stored or remove_image:
        data["inherited_image_url"] = ""
    try:
        with transaction.atomic():
            changed = Submission.objects.filter(pk=item.pk, author=item.author, revision=expected,
                status=Submission.Status.CHANGES).update(**data, image=image_name, status=Submission.Status.PENDING,
                review_note="", reviewer=None, reviewed_at=None, updated_at=timezone.now(), revision=F("revision") + 1)
            if changed != 1:
                raise Conflict()
            if old_image and old_image != image_name:
                transaction.on_commit(lambda: delete_unreferenced_image(old_image))
    except Exception:
        if stored:
            default_storage.delete(stored)
        raise
    item.refresh_from_db()
    return item

@transaction.atomic
def review_submission(identifier, expected, decision, note, reviewer):
    if not reviewer.is_active or not reviewer.is_staff:
        raise ReviewConflict("需要管理员权限。")
    item = Submission.objects.select_for_update().get(pk=identifier)
    if item.revision != expected or item.status != Submission.Status.PENDING:
        raise ReviewConflict("投稿状态已变化，请刷新后再审核。")
    if decision not in {Submission.Status.APPROVED, Submission.Status.CHANGES}:
        raise ReviewConflict("请选择通过或需修改。")
    if decision == Submission.Status.CHANGES and not note.strip():
        raise ReviewConflict("请填写修改建议。")
    claimed = Submission.objects.filter(pk=identifier, revision=expected, status=Submission.Status.PENDING).update(
        status=decision, review_note=note.strip(), reviewer=reviewer, reviewed_at=timezone.now(),
        updated_at=timezone.now(), revision=F("revision") + 1)
    if claimed != 1:
        raise ReviewConflict("这条投稿已被处理，请刷新。")
    if decision == Submission.Status.APPROVED:
        category = {Submission.Kind.FOOD: "food", Submission.Kind.GROUP: "groups"}.get(item.kind, "tips")
        body = item.body
        if item.location:
            body = f"相关地点或路线：{item.location}\n\n{body}"
        if item.edit_of_id:
            entry = GuideEntry.objects.select_for_update().get(pk=item.edit_of_id)
            if not entry.published or entry.updated_at != item.base_entry_updated_at:
                raise ReviewConflict("公开内容已更新或下线，请先退回并说明需要核对的内容。")
            entry.title = item.title
            entry.body = body
            entry.external_url = item.external_url
            entry.current_submission = item
            # An explicit image removal also clears any administrator-supplied image URL.
            entry.image_url = item.inherited_image_url
            entry.save(update_fields=["title", "body", "external_url", "current_submission", "image_url", "updated_at"])
        else:
            entry = GuideEntry.objects.create(category=GuideCategory.objects.get(pk=category), title=item.title,
                body=body, external_url=item.external_url, is_example=False, published=True, sort_order=100,
                current_submission=item)
        Submission.objects.filter(pk=identifier).update(public_entry=entry)
    item.refresh_from_db()
    return item
