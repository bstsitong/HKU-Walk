import secrets
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError

class Command(BaseCommand):
    help = "以临时测试对象验证私有图片存储的写入、读取和清理。"

    def handle(self, *args, **options):
        name = "healthcheck/" + secrets.token_hex(16) + ".txt"
        saved = None
        try:
            saved = default_storage.save(name, ContentFile(b"hku-walk-storage-check"))
            with default_storage.open(saved, "rb") as source:
                if source.read() != b"hku-walk-storage-check":
                    raise CommandError("图片存储读取校验失败。")
        except Exception as error:
            raise CommandError("图片存储验证失败，请检查私有存储配置。") from error
        finally:
            if saved:
                default_storage.delete(saved)
        self.stdout.write("私有图片存储写入、读取和清理检查通过。")
