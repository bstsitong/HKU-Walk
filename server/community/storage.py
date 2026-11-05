"""Django Storage backed by the private application database, with a hard byte quota.

Suitable for the classroom demo. Larger deployments can switch to private S3.
All image access still goes through the permission-checked submission endpoint.
"""
from pathlib import PurePosixPath

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.db import transaction
from django.utils.deconstruct import deconstructible


class MediaQuotaExceeded(Exception):
    pass


def safe_name(name, allow_root=False):
    if name == "" and allow_root:
        return ""
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name or str(path) != name:
        raise SuspiciousFileOperation("Invalid private media path.")
    return name


@deconstructible
class DatabaseStorage(Storage):
    def _open(self, name, mode="rb"):
        from .models import StoredMedia
        if mode not in {"r", "rb"}:
            raise ValueError("Private media may only be opened for reading.")
        try:
            data = StoredMedia.objects.only("content").get(pk=safe_name(name))
        except StoredMedia.DoesNotExist as error:
            raise FileNotFoundError(name) from error
        return ContentFile(bytes(data.content), name=name)

    def _save(self, name, content):
        from .models import MediaQuota, StoredMedia
        safe_name(name)
        data = content.read(5 * 1024 * 1024 + 1)
        if len(data) > 5 * 1024 * 1024:
            raise MediaQuotaExceeded("Single image exceeds the upload limit.")
        with transaction.atomic():
            MediaQuota.objects.get_or_create(pk=1)
            quota = MediaQuota.objects.select_for_update().get(pk=1)
            if quota.used_bytes + len(data) > settings.MEDIA_DATABASE_MAX_BYTES:
                raise MediaQuotaExceeded("Private media capacity reached.")
            StoredMedia.objects.create(name=name, content=data, size_bytes=len(data))
            quota.used_bytes += len(data)
            quota.save(update_fields=["used_bytes"])
        return name

    def delete(self, name):
        from .models import MediaQuota, StoredMedia
        safe_name(name)
        with transaction.atomic():
            MediaQuota.objects.get_or_create(pk=1)
            quota = MediaQuota.objects.select_for_update().get(pk=1)
            item = StoredMedia.objects.filter(pk=name).first()
            if item:
                quota.used_bytes = max(0, quota.used_bytes - item.size_bytes)
                item.delete()
                quota.save(update_fields=["used_bytes"])

    def exists(self, name):
        from .models import StoredMedia
        return StoredMedia.objects.filter(pk=safe_name(name)).exists()

    def size(self, name):
        from .models import StoredMedia
        try:
            return StoredMedia.objects.values_list("size_bytes", flat=True).get(pk=safe_name(name))
        except StoredMedia.DoesNotExist as error:
            raise FileNotFoundError(name) from error

    def listdir(self, path):
        from .models import StoredMedia
        prefix = safe_name(path, allow_root=True)
        prefix = prefix + "/" if prefix else ""
        directories, files = set(), []
        for name in StoredMedia.objects.filter(name__startswith=prefix).values_list("name", flat=True):
            relative = name[len(prefix):]
            if "/" in relative:
                directories.add(relative.split("/", 1)[0])
            else:
                files.append(relative)
        return sorted(directories), sorted(files)

    def url(self, name):
        raise ValueError("Use the permission-checked submission image endpoint.")
