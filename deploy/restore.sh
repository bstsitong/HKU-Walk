#!/bin/sh
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
    printf 'Usage: COMPOSE_PROJECT_NAME=hku-walk-restore sh deploy/restore.sh /absolute/backup.zip\n' >&2
    exit 1
fi
backup=$(realpath "$1")
cd "$(dirname "$0")"
if [ -z "${COMPOSE_PROJECT_NAME:-}" ] || [ "$COMPOSE_PROJECT_NAME" = "hku-walk" ]; then
    printf 'Choose a separate COMPOSE_PROJECT_NAME so the original deployment stays intact.\n' >&2
    exit 1
fi
docker compose up -d --wait db
docker compose run --rm --no-deps --entrypoint python api /app/server/manage.py migrate --noinput
docker compose run --rm --no-deps --entrypoint python api /app/server/manage.py createcachetable
docker compose run --rm --no-deps --volume "$backup:/restore.zip:ro" --entrypoint python api /app/server/manage.py restore_project /restore.zip
docker compose up -d --wait api
printf 'Restored application is running internally. Verify it before switching the public web service. The original deployment is unchanged.\n'
