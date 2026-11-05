"""Portable backup. Database images share the DB snapshot; pause external-storage writers."""
import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.core.files.storage import default_storage
from community.models import Submission

def digest_file(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


class Command(BaseCommand):
    help = "备份账号、指南、投稿和图片；外部图片存储需先暂停写入。备份包含密码摘要，请妥善保管。"

    def add_arguments(self, parser):
        parser.add_argument("--output", default="")

    def handle(self, *args, **options):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output = Path(options["output"] or settings.LOCAL_DIR / "backups" / f"hku-walk-{stamp}.zip").resolve()
        media = Path(settings.MEDIA_ROOT).resolve()
        if output.is_relative_to(media) or output.exists():
            raise CommandError("备份不能覆盖现有文件，也不能放在图片目录内。")
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=settings.LOCAL_DIR) as temp:
            fixture = Path(temp) / "data.json"
            with fixture.open("w", encoding="utf-8") as handle, transaction.atomic():
                if connection.vendor == "postgresql":
                    with connection.cursor() as cursor:
                        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                call_command("dumpdata", natural_foreign=True, natural_primary=True,
                    exclude=["contenttypes", "auth.permission", "sessions", "community.mobilesession",
                        "community.storedmedia", "community.mediaquota"], stdout=handle)
                image_names = list(Submission.objects.exclude(image="").values_list("image", flat=True).distinct())
                files = {"data.json": fixture}
                # DatabaseStorage reads image bytes from this same repeatable-read snapshot.
                for name in image_names:
                    path = PurePosixPath(name)
                    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
                        raise CommandError("图片记录包含无效路径，已取消备份。")
                    target = Path(temp) / "uploads" / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with default_storage.open(name, "rb") as source, target.open("wb") as destination:
                        shutil.copyfileobj(source, destination)
                    files["uploads/" + name] = target
            manifest = {"formatVersion": 1, "createdAt": stamp, "databaseEngine": connection.vendor,
                "files": {name: digest_file(path) for name, path in files.items()}}
            # Exclusive creation prevents overwriting a backup with the same timestamp.
            created = False
            try:
                fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                created = True
                with os.fdopen(fd, "wb") as target, zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for name, source in files.items():
                        archive.write(source, name)
                    archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            except Exception:
                if created:
                    output.unlink(missing_ok=True)
                raise
        self.stdout.write(f"备份完成：{output}（包含账号及恢复码摘要；不包含登录会话和服务端密钥）")
