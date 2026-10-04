#!/usr/bin/env bash
# Lokale/Agent-Sicherung vor Deploy oder großen Änderungen.
# Schreibt nach _backup/<UTC-Stamp>/ (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DEST:-$ROOT/_backup/$STAMP}"

mkdir -p "$DEST/critical"
cd "$ROOT"

echo "==> Lokale Sicherung $STAMP → $DEST"

git bundle create "$DEST/wog-app.bundle" --all
git rev-parse HEAD > "$DEST/HEAD.txt"
git status -sb > "$DEST/git-status.txt"
git log --oneline -30 > "$DEST/git-log.txt"
git rev-parse --abbrev-ref HEAD > "$DEST/BRANCH.txt"

if [[ -d portal ]]; then
  tar -C portal -czf "$DEST/portal-src.tgz" \
    --exclude=node_modules \
    --exclude='apps/*/node_modules' \
    --exclude='packages/*/node_modules' \
    --exclude='apps/web/.next' \
    --exclude='apps/api/dist' \
    --exclude='data/uploads' \
    --exclude='data/sftp/inbound' \
    --exclude='data/sftp/outbound' \
    .
  for f in \
    portal/apps/api/src/customs/ezoll-soloplan.service.ts \
    portal/apps/api/src/integrations/soloplan-order.mapper.ts \
    portal/apps/api/test/ezoll-soloplan.write-safety.test.ts \
    portal/apps/api/test/soloplan-smartborder-fields.test.ts
  do
    [[ -f "$f" ]] && cp "$f" "$DEST/critical/"
  done
fi

{
  echo "stamp=$STAMP"
  echo "host=$(hostname -f 2>/dev/null || hostname)"
  echo "branch=$(cat "$DEST/BRANCH.txt")"
  echo "commit=$(cat "$DEST/HEAD.txt")"
  ls -lh "$DEST"
} | tee "$DEST/manifest.txt"

echo "==> Fertig: $DEST"
