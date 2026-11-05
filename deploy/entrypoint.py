"""Production startup. Secret values are read from mounted files, never logged."""
import os
import sys
sys.path.insert(0, "/app/server")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.core.management import call_command
from django.db import connections

def manage(*args):
    call_command(*args)

manage("prepare_database")
manage("migrate", "--noinput")
manage("createcachetable")
manage("prepare_database", "--seal")
manage("seed_guide")
manage("init_admin")
manage("collectstatic", "--noinput")
manage("check_storage")
manage("check", "--deploy", "--fail-level", "WARNING")
connections.close_all()
os.chdir("/app/server")
os.execvp("gunicorn", ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:" + os.environ.get("PORT", "8000"),
    "--workers", os.environ.get("WEB_CONCURRENCY", "2"), "--threads", "2", "--timeout", "60",
    "--access-logfile", "-", "--error-logfile", "-", "--forwarded-allow-ips", "*"])
