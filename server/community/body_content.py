from django.urls import reverse
from rest_framework.exceptions import ValidationError

BODY_TYPES = {"paragraph", "heading", "list", "quote", "image"}
MAX_BODY_BLOCKS = 40
MAX_BODY_IMAGES = 12


def validate_body_blocks(blocks):
    if not isinstance(blocks, list) or len(blocks) > MAX_BODY_BLOCKS:
        raise ValidationError({"body": "正文最多可添加 40 个区块。"})
    result = []
    for block in blocks:
        if not isinstance(block, dict) or not isinstance(block.get("type"), str) or block["type"] not in BODY_TYPES:
            raise ValidationError({"body": "正文排版格式不正确。"})
        value = block.get("text", "")
        if not isinstance(value, str):
            raise ValidationError({"body": "正文排版格式不正确。"})
        value = value.strip()
        if block["type"] == "image":
            if len(value) > 300:
                raise ValidationError({"body": "每张图片的说明最多 300 字。"})
        elif not value:
            raise ValidationError({"body": "请填写正文，或移除空白区块。"})
        result.append({"type": block["type"], "text": value})
    if sum(len(block["text"]) for block in result) > 8000:
        raise ValidationError({"body": "正文最多 8000 字。"})
    if sum(block["type"] == "image" for block in result) > MAX_BODY_IMAGES:
        raise ValidationError({"body": "正文最多可插入 12 张图片。"})
    return result


def body_blocks_data(request, submission):
    if not submission or not submission.body_blocks:
        return []
    images = {image.block_index: image.pk for image in submission.body_images.all()}
    return [
        {**block, "sourceIndex": index,
         "imageUrl": request.build_absolute_uri(reverse("submission-body-image", args=[images[index]]))}
        if index in images and block["type"] == "image" else block
        for index, block in enumerate(submission.body_blocks)
    ]


def publication_body(submission):
    return f"相关地点或路线：{submission.location}\n\n{submission.body}" if submission.location else submission.body


def published_body_blocks(request, post, source):
    return body_blocks_data(request, source) if source and post.body == publication_body(source) else []
