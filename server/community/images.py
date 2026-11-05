import io
import uuid
import warnings

from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

def clean_image(upload):
    if upload.size > 5 * 1024 * 1024:
        raise ValidationError("图片请控制在 5 MB 以内。")
    raw = upload.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise ValidationError("图片请控制在 5 MB 以内。")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"} or getattr(image, "is_animated", False):
                    raise ValidationError("请选择 JPG、PNG 或 WebP 静态图片。")
                if image.width * image.height > 25_000_000 or max(image.size) > 8192:
                    raise ValidationError("图片分辨率过大，请缩小后再上传。")
                image.load()
                cleaned = ImageOps.exif_transpose(image).convert("RGB")
                cleaned.thumbnail((1600, 1600))
                output = io.BytesIO()
                cleaned.save(output, format="JPEG", quality=85)
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError("无法读取这张图片，请换一张重试。")
    return ContentFile(output.getvalue(), name=f"{uuid.uuid4().hex}.jpg")
