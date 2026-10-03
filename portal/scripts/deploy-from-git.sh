#!/usr/bin/env bash
# Deploy api+worker aus dem aktuellen Git-Tree (Images neu bauen).
# Vorher: optional Backup. Keine Live-Patches im Container.
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(cd .. && pwd)"
DO_BACKUP="${DO_BACKUP:-1}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-wogportal}"

if [[ "$DO_BACKUP" == "1" ]]; then
  if [[ -x ./scripts/backup-portal.sh ]] && docker compose -p "$COMPOSE_PROJECT" ps postgres 2>/dev/null | grep -q Up; then
    echo "==> Prod-Backup (DB + data)…"
    ./scripts/backup-portal.sh || echo "WARN: backup-portal.sh fehlgeschlagen – weiter mit lokalem Snapshot"
  fi
  if [[ -x ./scripts/backup-local.sh ]]; then
    echo "==> Lokaler Git/Source-Snapshot…"
    ./scripts/backup-local.sh || true
  fi
fi

echo "==> Git-Stand: $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') @ $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"

export COMPOSE_PARALLEL_LIMIT=1
export DOCKER_BUILDKIT=1
export BUILDKIT_STEP_LOG_MAX_SIZE=10485760

echo "==> Build api (ohne Web/Next)…"
docker compose -p "$COMPOSE_PROJECT" build api

echo "==> Build worker (Cache von api)…"
docker compose -p "$COMPOSE_PROJECT" build worker

echo "==> Restart nur api + worker…"
docker compose -p "$COMPOSE_PROJECT" up -d --no-deps api worker

echo "==> Status"
docker compose -p "$COMPOSE_PROJECT" ps
echo "OK: API/Worker aus Git-Image ausgerollt (kein Live-Patch)."
echo "Smoke: siehe docs/HANDBUCH.md §6 und docs/PROD_BASELINE.md §4.3"
