"""Production startup. Secret values are read from mounted files, never logged."""
import os
import subprocess
import sys

def manage(*args):
    subprocess.run([sys.executable, "/app/server/manage.py", *args], check=True)

manage("prepare_database")
manage("migrate", "--noinput")
manage("createcachetable")
manage("prepare_database", "--seal")
manage("seed_guide")
manage("init_admin")
manage("collectstatic", "--noinput")
manage("check_storage")
manage("check", "--deploy", "--fail-level", "WARNING")
os.chdir("/app/server")
os.execvp("gunicorn", ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000",
    "--workers", os.environ.get("WEB_CONCURRENCY", "2"), "--threads", "2", "--timeout", "60",
    "--access-logfile", "-", "--error-logfile", "-", "--forwarded-allow-ips", "*"])
