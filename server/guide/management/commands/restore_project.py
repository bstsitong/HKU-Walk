import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.core.files.storage import default_storage
from django.core.files import File
from community.models import Submission
from guide.models import GuideCategory, GuideEntry

def storage_has_files(path=""):
    try:
        folders, files = default_storage.listdir(path)
    except FileNotFoundError:
        return False
    return bool(files) or any(storage_has_files((path + "/" if path else "") + folder) for folder in folders)

class Command(BaseCommand):
    help = "校验备份并恢复到已迁移但未初始化数据的空数据库。不会覆盖现有账号或内容。"

    def add_arguments(self, parser):
        parser.add_argument("archive")

    def handle(self, *args, **options):
        media = Path(settings.MEDIA_ROOT).resolve()
        storage_empty = not storage_has_files()
        if (get_user_model().objects.exists() or GuideCategory.objects.exists() or GuideEntry.objects.exists()
                or Submission.objects.exists() or not storage_empty):
            raise CommandError("恢复目标必须是空数据库和空图片目录；请使用新的数据目录与数据库。")
        with tempfile.TemporaryDirectory(dir=settings.LOCAL_DIR) as directory:
            stage = Path(directory).resolve()
            try:
                with zipfile.ZipFile(options["archive"]) as archive:
                    if len(archive.namelist()) != len(set(archive.namelist())):
                        raise CommandError("备份含重复文件名。")
                    manifest = json.loads(archive.read("manifest.json"))
                    expected = manifest.get("files", {})
                    if manifest.get("formatVersion") != 1 or "data.json" not in expected or set(archive.namelist()) != set(expected) | {"manifest.json"}:
                        raise CommandError("备份格式或文件清单不完整。")
                    for name, digest in expected.items():
                        path = PurePosixPath(name)
                        if (path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name
                                or (name != "data.json" and not name.startswith("uploads/"))):
                            raise CommandError("备份包含无效路径。")
                        target = (stage / name).resolve()
                        if not target.is_relative_to(stage):
                            raise CommandError("备份路径超出恢复目录。")
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(name) as source, target.open("wb") as destination:
                            shutil.copyfileobj(source, destination)
                        with target.open("rb") as handle:
                            actual = hashlib.file_digest(handle, "sha256").hexdigest()
                        if actual != digest:
                            raise CommandError("备份文件校验失败，未恢复任何数据。")
            except (zipfile.BadZipFile, KeyError, ValueError) as error:
                raise CommandError("无法读取这份备份。") from error
            created = []
            try:
                with transaction.atomic():
                    call_command("loaddata", str(stage / "data.json"), verbosity=0)
                    for source in (stage / "uploads").rglob("*"):
                        if source.is_file():
                            target = (media / source.relative_to(stage / "uploads")).resolve()
                            if not target.is_relative_to(media):
                                raise CommandError("图片路径超出目标目录。")
                            name = source.relative_to(stage / "uploads").as_posix()
                            with source.open("rb") as input_file:
                                saved = default_storage.save(name, File(input_file))
                            created.append(saved)
                            if saved != name:
                                raise CommandError("图片存储中出现同名文件，已取消恢复。")
            except Exception:
                for name in created:
                    default_storage.delete(name)
                raise
        self.stdout.write("恢复完成。账号、指南、投稿和图片已恢复；用户需要重新登录。")
