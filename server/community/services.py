import hashlib
import json
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from guide.legacy_catalog import place_fields
from guide.map_display import place_display_level
from guide.models import CampusPlace, CampusRoute, GuidePost, Publication, RouteStep
from .body_content import publication_body
from .models import InboxMessage, Submission, SubmissionBodyImage, SubmissionStepImage
from .map_content import validate_map_data
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
    if name and not any(model.objects.filter(image=name).exists() for model in (Submission, SubmissionStepImage, SubmissionBodyImage)):
        default_storage.delete(name)

def store_images(data, step_uploads, body_uploads):
    names = []
    try:
        cover = prepare_image(data)
        if cover:
            names.append(cover)
        groups = []
        for uploads in (step_uploads, body_uploads):
            stored = {}
            for index, upload in uploads.items():
                stored[index] = prepare_image({"image": upload})
                names.append(stored[index])
            groups.append(stored)
        return cover, *groups
    except Exception:
        for name in names:
            delete_unreferenced_image(name)
        raise

def image_names(source, relation, index_field):
    return {getattr(image, index_field): image.image.name for image in getattr(source, relation).all()} if source else {}

def planned_images(inherited, removed, source_images, uploads):
    result = {}
    for target, source in inherited.items():
        target = int(target)
        if target in removed or target in uploads:
            continue
        if source not in source_images:
            raise ValidationError({"image": "原配图已变化，请刷新后重新编辑。"})
        result[target] = source_images[source]
    return result

def create_images(model, index_field, item, inherited, stored):
    names = {**inherited, **stored}
    model.objects.bulk_create([model(submission=item, image=name, **{index_field: index}) for index, name in names.items()])

def submit_new(user, data, edit_of=None, inherited_image="", inherited_image_url="", base_version=None, source=None):
    request_key = data.pop("request_key", "")
    if not request_key:
        raise ValidationError({"request_key": "缺少投稿编号，请重新打开投稿表单。"})
    data.pop("revision", None)
    remove_image = data.pop("remove_image", False)
    data.pop("base_version", None)
    uploads = data.pop("step_images", {})
    body_uploads = data.pop("body_images", {})
    digest = hashlib.sha256()
    scalar = {key: value for key, value in data.items() if key != "image"}
    # Keep fingerprints compatible with retries of submissions sent before map fields existed.
    for field in ("map_data", "inherit_step_images", "remove_step_images", "body_blocks", "inherit_body_images"):
        if not scalar.get(field):
            scalar.pop(field, None)
    scalar.update(edit_of=str(edit_of.pk) if edit_of else None, remove_image=remove_image,
        base_version=base_version.isoformat() if base_version else None)
    digest.update(json.dumps(scalar, sort_keys=True, ensure_ascii=False).encode())
    if data.get("image"):
        digest.update(data["image"].read())
        data["image"].seek(0)
    for index, image in sorted(uploads.items()):
        digest.update(str(index).encode())
        digest.update(image.read())
        image.seek(0)
    for index, image in sorted(body_uploads.items()):
        digest.update(f"body:{index}:".encode())
        digest.update(image.read())
        image.seek(0)
    fingerprint = digest.hexdigest()
    existing = Submission.objects.filter(author=user, request_key=request_key).first()
    if existing:
        if existing.content_hash != fingerprint:
            raise Conflict("上一次投稿已经收到，请先查看我的投稿。")
        return existing, False
    inherited_steps = planned_images(data.pop("inherit_step_images", {}), data.pop("remove_step_images", []),
        image_names(source, "step_images", "step_index"), uploads)
    inherited_body = planned_images(data.pop("inherit_body_images", {}), (),
        image_names(source, "body_images", "block_index"), body_uploads)
    stored, stored_steps, stored_body = store_images(data, uploads, body_uploads)
    try:
        with transaction.atomic():
            result = Submission.objects.create(author=user, request_key=request_key, content_hash=fingerprint,
                image=stored or ("" if remove_image else inherited_image), edit_of=edit_of,
                inherited_image_url="" if stored or remove_image else inherited_image_url,
                base_entry_updated_at=base_version, **data)
            create_images(SubmissionStepImage, "step_index", result, inherited_steps, stored_steps)
            create_images(SubmissionBodyImage, "block_index", result, inherited_body, stored_body)
        return result, True
    except IntegrityError:
        if stored:
            default_storage.delete(stored)
        for name in (*stored_steps.values(), *stored_body.values()):
            delete_unreferenced_image(name)
        existing = Submission.objects.filter(author=user, request_key=request_key).first()
        if existing and existing.content_hash == fingerprint:
            return existing, False
        raise Conflict("这条内容已有未完成的修改申请，请先在我的投稿中处理。" if edit_of else None)
    except Exception:
        if stored:
            default_storage.delete(stored)
        for name in (*stored_steps.values(), *stored_body.values()):
            delete_unreferenced_image(name)
        raise

def submit_edit(user, source, data):
    if source.author_id != user.pk or source.status != Submission.Status.APPROVED or not source.public_entry_id:
        raise Conflict("只有本人已发布的内容可以申请修改。")
    entry = Publication.objects.select_related("current_submission", "post", "place", "route").get(pk=source.public_entry_id)
    expected = data.get("base_version")
    if not entry.published or expected != entry.updated_at:
        raise Conflict("公开内容已更新或下线，请刷新投稿详情后再申请修改。")
    if data["kind"] != source.kind:
        raise ValidationError({"kind": "修改申请不能更换投稿类型。"})
    current = entry.current_submission
    if current and current.body_blocks and not data.get("body_blocks"):
        raise ValidationError({"body": "请使用新版图文编辑器修改这篇投稿。"})
    return submit_new(user, data, edit_of=entry,
        inherited_image=current.image.name if current and current.image else "",
        inherited_image_url=entry.content.image_url, base_version=expected, source=current)

def resubmit(item, data):
    expected = data.pop("revision", None)
    data.pop("request_key", None)
    remove_image = data.pop("remove_image", False)
    base_version = data.pop("base_version", None)
    uploads = data.pop("step_images", {})
    body_uploads = data.pop("body_images", {})
    if item.body_blocks and not data.get("body_blocks"):
        raise ValidationError({"body": "请使用新版图文编辑器修改这篇投稿。"})
    step_sources = image_names(item, "step_images", "step_index")
    body_sources = image_names(item, "body_images", "block_index")
    inherited_steps = planned_images(data.pop("inherit_step_images", {}), data.pop("remove_step_images", []), step_sources, uploads)
    inherited_body = planned_images(data.pop("inherit_body_images", {}), (), body_sources, body_uploads)
    if item.status != Submission.Status.CHANGES or item.revision != expected:
        raise Conflict("请刷新投稿状态，只有需修改的投稿可以重新提交。")
    if item.edit_of_id:
        entry = Publication.objects.get(pk=item.edit_of_id)
        if not entry.published or base_version != entry.updated_at:
            raise Conflict("原内容已更新或下线，请刷新后重新查看修改申请。")
        if data["kind"] != item.kind:
            raise ValidationError({"kind": "修改申请不能更换投稿类型。"})
        data["base_entry_updated_at"] = base_version
    stored, stored_steps, stored_body = store_images(data, uploads, body_uploads)
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
            item.step_images.all().delete()
            item.body_images.all().delete()
            create_images(SubmissionStepImage, "step_index", item, inherited_steps, stored_steps)
            create_images(SubmissionBodyImage, "block_index", item, inherited_body, stored_body)
            for old_name in (*step_sources.values(), *body_sources.values()):
                transaction.on_commit(lambda name=old_name: delete_unreferenced_image(name))
            if old_image and old_image != image_name:
                transaction.on_commit(lambda: delete_unreferenced_image(old_image))
    except Exception:
        if stored:
            default_storage.delete(stored)
        for name in (*stored_steps.values(), *stored_body.values()):
            delete_unreferenced_image(name)
        raise
    item.refresh_from_db()
    return item


def publish_content(item):
    try:
        data = validate_map_data(item.kind, item.map_data)
    except ValidationError as error:
        raise ReviewConflict(str(error.detail))
    kind = {Submission.Kind.NEW_PLACE: Publication.Kind.PLACE,
            Submission.Kind.NEW_ROUTE: Publication.Kind.ROUTE}.get(item.kind, Publication.Kind.POST)
    if item.edit_of_id:
        publication = Publication.objects.select_for_update().get(pk=item.edit_of_id)
        if not publication.published or publication.updated_at != item.base_entry_updated_at or publication.kind != kind:
            raise ReviewConflict("公开内容已更新或下线，请先退回并说明需要核对的内容。")
        publication.current_submission = item
        publication.save(update_fields=["current_submission", "updated_at"])
    else:
        publication = Publication.objects.create(kind=kind, sort_order=100, current_submission=item)

    # A place's uploaded introduction is its detail-page description, including an intentional blank.
    body = item.body if kind == Publication.Kind.PLACE else publication_body(item)
    common = {"body": body, "external_url": item.external_url, "image_url": item.inherited_image_url}
    if kind == Publication.Kind.PLACE:
        details = place_fields(data)
        details["map_version"] = data["mapVersion"]
        # Older app versions omit this field when editing a published place.
        if "abbreviation" not in data and item.edit_of_id:
            details.pop("abbreviation_en")
        CampusPlace.objects.update_or_create(
            publication=publication,
            defaults={"code": f"community-place-{publication.pk}", "name_zh": item.title, **common, **details},
            create_defaults={"code": f"community-place-{publication.pk}", "name_zh": item.title,
                             "display_level": place_display_level(data["category"]), **common, **details},
        )
    elif kind == Publication.Kind.ROUTE:
        route, _ = CampusRoute.objects.update_or_create(publication=publication, defaults={
            "title": item.title, "origin_id": data["originId"], "destination_id": data["destinationId"], **common,
        })
        photos = {photo.step_index: photo for photo in item.step_images.all()}
        route.steps.all().delete()
        RouteStep.objects.bulk_create([
            RouteStep(route=route, position=index, title=step["title"], body=step["body"], photo=photos.get(index))
            for index, step in enumerate(data["steps"])
        ])
    else:
        category = {Submission.Kind.FOOD: "food", Submission.Kind.GROUP: "groups"}.get(item.kind, "tips")
        GuidePost.objects.update_or_create(
            publication=publication, defaults={"title": item.title, **common},
            create_defaults={"title": item.title, "category_id": category, "published_at": publication.updated_at, **common},
        )
    return publication


@transaction.atomic
def review_submission(identifier, expected, decision, note, reviewer):
    if not reviewer.is_active or not reviewer.is_staff:
        raise ReviewConflict("需要管理员权限。")
    item = Submission.objects.select_for_update().get(pk=identifier)
    if item.revision != expected or item.status != Submission.Status.PENDING:
        raise ReviewConflict("投稿状态已变化，请刷新后再审核。")
    if decision not in {Submission.Status.APPROVED, Submission.Status.CHANGES, Submission.Status.REJECTED}:
        raise ReviewConflict("请选择通过、需修改或拒绝。")
    if decision == Submission.Status.CHANGES and not note.strip():
        raise ReviewConflict("请填写修改建议。")
    if decision == Submission.Status.REJECTED and not note.strip():
        raise ReviewConflict("请填写拒绝原因。")
    claimed = Submission.objects.filter(pk=identifier, revision=expected, status=Submission.Status.PENDING).update(
        status=decision, review_note=note.strip(), reviewer=reviewer, reviewed_at=timezone.now(),
        updated_at=timezone.now(), revision=F("revision") + 1)
    if claimed != 1:
        raise ReviewConflict("这条投稿已被处理，请刷新。")
    if decision == Submission.Status.APPROVED:
        publication = publish_content(item)
        Submission.objects.filter(pk=identifier).update(public_entry=publication)
    InboxMessage.objects.create(recipient_id=item.author_id, kind=InboxMessage.Kind.REVIEW, submission=item,
                                review_status=decision, review_title=item.title, review_note=note.strip())
    item.refresh_from_db()
    return item
