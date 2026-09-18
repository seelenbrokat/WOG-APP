#!/usr/bin/env bash
# WOG Portal – Backup (Postgres + Uploads + SFTP-Daten)
# Empfohlen: täglich via cron, z. B. 02:15
#   15 2 * * * /opt/wog-portal/portal/scripts/backup-portal.sh >> /var/log/wog-portal-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wog-portal}"
PORTAL_DIR="${PORTAL_DIR:-$APP_DIR/portal}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/wog-portal}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-wogportal}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"

mkdir -p "$DEST"
cd "$PORTAL_DIR"

echo "==> Backup $STAMP → $DEST"

# Postgres-Dump aus Container
docker compose -p "$COMPOSE_PROJECT" exec -T postgres \
  pg_dump -U wog -d wog_portal --no-owner --format=custom \
  > "$DEST/wog_portal.dump"

# Dateien (Uploads, SFTP-Austausch, Integration)
tar -C "$PORTAL_DIR" -czf "$DEST/data.tgz" \
  --exclude='data/sftp/**/.gitkeep' \
  data/uploads data/sftp data/integrations 2>/dev/null || \
  tar -C "$PORTAL_DIR" -czf "$DEST/data.tgz" data

# Kompakte Meta
{
  echo "stamp=$STAMP"
  echo "host=$(hostname -f 2>/dev/null || hostname)"
  echo "branch=$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "commit=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  ls -lh "$DEST"
} > "$DEST/manifest.txt"

# Alte Backups löschen
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +

echo "==> Backup fertig: $DEST (Retention ${KEEP_DAYS} Tage)"
echo "Restore DB: docker compose exec -T postgres pg_restore -U wog -d wog_portal --clean --if-exists < $DEST/wog_portal.dump"
