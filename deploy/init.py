"""Create deployment files without printing credentials or replacing existing files."""
import argparse
import os
import re
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--domain", required=True, help="An owned DNS hostname, without https://")
args = parser.parse_args()
if not re.fullmatch(r"(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}", args.domain):
    parser.error("Use a DNS hostname such as campus.example.com, without a path or port.")
root = Path(__file__).resolve().parent
config = root / ".env"
if config.exists() and config.read_text(encoding="utf-8").strip() != f"APP_DOMAIN={args.domain}":
    parser.error("deploy/.env already exists with different content; review it before changing the domain.")
directory = root / "secrets"
directory.mkdir(mode=0o700, exist_ok=True)
for name, value in {"django_secret_key": secrets.token_urlsafe(64), "postgres_password": secrets.token_hex(32), "admin_password": secrets.token_urlsafe(32)}.items():
    target = directory / name
    if not target.exists():
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(value)
if not config.exists():
    config.write_text(f"APP_DOMAIN={args.domain}\n", encoding="utf-8")
(root / "backups").mkdir(mode=0o700, exist_ok=True)
print("Deployment files ready. Existing credentials were preserved. No service has been deployed yet.")
