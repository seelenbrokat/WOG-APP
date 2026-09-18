#!/usr/bin/env bash
# WOG Portal – Monitoring / Uptime-Check
# Empfohlen: alle 5 Minuten via cron
#   */5 * * * * /opt/wog-portal/portal/scripts/monitor-portal.sh >> /var/log/wog-portal-monitor.log 2>&1
#
# Optional Alert:
#   MONITOR_WEBHOOK_URL=https://hooks.slack.com/...   (POST JSON text)
#   MONITOR_MAIL_TO=ops@example.com                   (mailx/sendmail falls vorhanden)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wog-portal}"
PORTAL_DIR="${PORTAL_DIR:-$APP_DIR/portal}"
DOMAIN="${DOMAIN:-wog.logistikberater.at}"
HEALTH_URL="${HEALTH_URL:-https://$DOMAIN/api/health/ready}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-wogportal}"
STATE_FILE="${STATE_FILE:-/var/tmp/wog-portal-monitor.state}"

fail() {
  local msg="$1"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) FAIL $msg"
  if [[ -n "${MONITOR_WEBHOOK_URL:-}" ]]; then
    curl -sS -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"WOG Portal ALERT: $msg\"}" \
      "$MONITOR_WEBHOOK_URL" >/dev/null || true
  fi
  if [[ -n "${MONITOR_MAIL_TO:-}" ]] && command -v mail >/dev/null 2>&1; then
    echo "$msg" | mail -s "WOG Portal ALERT" "$MONITOR_MAIL_TO" || true
  fi
  echo "fail $(date -u +%s) $msg" > "$STATE_FILE"
  exit 1
}

# HTTP Readiness (inkl. DB)
code="$(curl -sS -o /tmp/wog-health.json -w '%{http_code}' --max-time 15 "$HEALTH_URL" || echo 000)"
if [[ "$code" != "200" ]]; then
  body="$(cat /tmp/wog-health.json 2>/dev/null || true)"
  fail "health/ready HTTP $code ${body:0:180}"
fi

# Container-Status
cd "$PORTAL_DIR"
missing=()
for svc in postgres redis api web worker; do
  if ! docker compose -p "$COMPOSE_PROJECT" ps --status running --services 2>/dev/null | grep -qx "$svc"; then
    missing+=("$svc")
  fi
done
if ((${#missing[@]})); then
  fail "Container nicht running: ${missing[*]}"
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) OK health=$code containers=up"
echo "ok $(date -u +%s)" > "$STATE_FILE"
