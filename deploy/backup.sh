#!/bin/sh
set -eu
cd "$(dirname "$0")"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="hku-walk-$stamp.zip"
mkdir -p backups
chmod 700 backups
# Stop every application worker so uploaded files and the database form one backup.
docker compose stop api
trap 'docker compose start api' EXIT HUP INT TERM
docker compose run --rm --no-deps --entrypoint python api /app/server/manage.py backup_project --output "/data/backups/$name"
docker compose cp "api:/data/backups/$name" "backups/$name"
chmod 600 "backups/$name"
printf 'Backup saved: %s\n' "backups/$name"
