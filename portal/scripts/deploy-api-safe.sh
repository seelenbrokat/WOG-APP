#!/usr/bin/env bash
# Schonender API/Worker-Deploy ohne Next.js-Build und ohne Parallel-Build.
# Laufende Container bleiben bis zum Image-Wechsel erreichbar (Fahrer-API bleibt online).
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PARALLEL_LIMIT=1
export DOCKER_BUILDKIT=1
export BUILDKIT_STEP_LOG_MAX_SIZE=10485760

echo "==> Build api (ohne Web/Next)…"
docker compose -p wogportal build api

echo "==> Build worker (Cache von api)…"
docker compose -p wogportal build worker

echo "==> Restart nur api + worker…"
docker compose -p wogportal up -d --no-deps api worker

echo "==> Status"
docker compose -p wogportal ps
echo "OK: API/Worker ausgerollt, Web unverändert."
