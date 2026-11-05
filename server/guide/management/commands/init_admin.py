import secrets
import os
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

class Command(BaseCommand):
    help = "首次初始化本机管理员，凭据保存到忽略的本机文件。"

    def handle(self, *args, **options):
        users = get_user_model()
        if users.objects.filter(username="hku_admin").exists():
            self.stdout.write("本机管理员已存在，密码保持原值。")
            return
        source = os.environ.get("DJANGO_ADMIN_PASSWORD_FILE")
        password = Path(source).read_text(encoding="utf-8").strip() if source else os.environ.get("DJANGO_ADMIN_PASSWORD", "")
        if not password and not settings.DEBUG:
            raise RuntimeError("Set DJANGO_ADMIN_PASSWORD or DJANGO_ADMIN_PASSWORD_FILE for the first production boot.")
        password = password or secrets.token_urlsafe(20)
        if len(password) < 16:
            raise RuntimeError("The bootstrap administrator password must contain at least 16 characters.")
        users.objects.create_superuser("hku_admin", password=password)
        output = settings.LOCAL_DIR / "admin-access.txt"
        output.write_text(
            f"港大漫游 · 管理员\n\n地址 {settings.PUBLIC_ORIGIN or 'http://127.0.0.1:8000'}/admin/\n"
            f"账号 hku_admin\n密码 {password}\n\n请勿将此文件上传或放入小组分享包。\n",
            encoding="utf-8",
        )
        output.chmod(0o600)
        self.stdout.write("本机管理员已创建。登录信息位于 .local/admin-access.txt。")
