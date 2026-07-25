#!/usr/bin/env bash
# Sicheres Side-by-Side-Deploy für wog.logistikberater.at
# - berührt keine anderen Nginx-Sites / Container / Systemdienste
# - bindet Portal-Ports nur auf 127.0.0.1
# - legt nur einen eigenen vHost für die genannte Domain an
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wog-portal}"
REPO_URL="${REPO_URL:-https://github.com/seelenbrokat/WOG-APP.git}"
BRANCH="${BRANCH:-cursor/wog-kundenportal-203f}"
DOMAIN="${DOMAIN:-wog.logistikberater.at}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-wogportal}"
# Host-Ports (nur localhost). Bei Konflikt per Env überschreiben.
WOG_WEB_PORT="${WOG_WEB_PORT:-3000}"
WOG_API_PORT="${WOG_API_PORT:-3001}"
WOG_PG_PORT="${WOG_PG_PORT:-5432}"
WOG_REDIS_PORT="${WOG_REDIS_PORT:-6379}"
ENABLE_SFTP="${ENABLE_SFTP:-0}"
ENABLE_CERTBOT="${ENABLE_CERTBOT:-1}"

log() { echo "==> $*"; }
die() { echo "FEHLER: $*" >&2; exit 1; }

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

pick_free_port() {
  local preferred="$1"
  local alt="$2"
  if ! port_in_use "$preferred"; then
    echo "$preferred"
    return
  fi
  # Wenn schon unser Compose darauf lauscht, Port behalten
  if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "wogportal.*:${preferred}->"; then
    echo "$preferred"
    return
  fi
  if ! port_in_use "$alt"; then
    echo "$alt"
    return
  fi
  die "Port $preferred und Ausweichport $alt sind belegt – bitte WOG_*_PORT setzen"
}

log "WOG Portal – sicheres Side-by-Side-Deploy"
echo "    Dir:     $APP_DIR"
echo "    Branch:  $BRANCH"
echo "    Domain:  $DOMAIN"
echo "    Project: $COMPOSE_PROJECT_NAME"

if [[ $EUID -ne 0 ]]; then
  die "Bitte als root ausführen (sudo)."
fi

# --- Bestandschutz: nichts stoppen / löschen ---
log "Bestandsaufnahme (nur lesen)"
echo "--- nginx sites-enabled ---"
ls -la /etc/nginx/sites-enabled 2>/dev/null || echo "(kein nginx sites-enabled)"
echo "--- laufende container (Namen) ---"
docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null || echo "(docker nicht aktiv oder keine Container)"
echo "--- listener :80 / :443 ---"
ss -ltnp 2>/dev/null | grep -E ':80 |:443 ' || netstat -ltnp 2>/dev/null | grep -E ':80 |:443 ' || true

export DEBIAN_FRONTEND=noninteractive

# Docker nur installieren wenn fehlend – bestehende Installation unangetastet
if ! command -v docker >/dev/null 2>&1; then
  log "Docker fehlt – Installation"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  log "Docker vorhanden – belasse bestehende Container unangetastet"
fi

# Compose Plugin sicherstellen
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin || true
fi

# Nginx nur installieren wenn fehlend – bestehende Config nicht überschreiben
if ! command -v nginx >/dev/null 2>&1; then
  log "Nginx fehlt – Installation"
  apt-get update -qq
  apt-get install -y -qq nginx
else
  log "Nginx vorhanden – bestehende Sites bleiben aktiv"
fi

# Freie localhost-Ports wählen (bestehende Dienste nicht verdrängen)
WOG_WEB_PORT="$(pick_free_port "$WOG_WEB_PORT" 13000)"
WOG_API_PORT="$(pick_free_port "$WOG_API_PORT" 13001)"
WOG_PG_PORT="$(pick_free_port "$WOG_PG_PORT" 15432)"
WOG_REDIS_PORT="$(pick_free_port "$WOG_REDIS_PORT" 16379)"
echo "    Ports: web=$WOG_WEB_PORT api=$WOG_API_PORT pg=$WOG_PG_PORT redis=$WOG_REDIS_PORT (alle 127.0.0.1)"

mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/portal"
export COMPOSE_PROJECT_NAME

# Override für Host-Ports (localhost only), ohne docker-compose.yml zu zerstören.
# !override ist nötig: Compose merged ports sonst und behält z.B. 3001 aus der Basisdatei
# (auf diesem VPS von Forgejo belegt).
cat > docker-compose.override.yml <<EOF
# generiert von deploy-server.sh – nicht manuell pflegen
services:
  postgres:
    ports: !override
      - "127.0.0.1:${WOG_PG_PORT}:5432"
  redis:
    ports: !override
      - "127.0.0.1:${WOG_REDIS_PORT}:6379"
  api:
    ports: !override
      - "127.0.0.1:${WOG_API_PORT}:3001"
  web:
    ports: !override
      - "127.0.0.1:${WOG_WEB_PORT}:3000"
EOF

if [[ ! -f .env ]]; then
  cp .env.example .env
  JWT=$(openssl rand -hex 32)
  ADMIN_PW=$(openssl rand -base64 12)
  SFTPGO_PW=$(openssl rand -base64 18)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  sed -i "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$ADMIN_PW|" .env
  sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" .env
  sed -i "s|^API_URL=.*|API_URL=https://$DOMAIN/api|" .env
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" .env
  # Erstes Setup: Admin einmal setzen, danach nicht mehr überschreiben
  if grep -q '^SEED_RESET_ADMIN_PASSWORD=' .env; then
    sed -i "s|^SEED_RESET_ADMIN_PASSWORD=.*|SEED_RESET_ADMIN_PASSWORD=true|" .env
  else
    echo "SEED_RESET_ADMIN_PASSWORD=true" >> .env
  fi
  if grep -q '^SFTPGO_ADMIN_PASSWORD=' .env; then
    sed -i "s|^SFTPGO_ADMIN_PASSWORD=.*|SFTPGO_ADMIN_PASSWORD=$SFTPGO_PW|" .env
  else
    echo "SFTPGO_ADMIN_PASSWORD=$SFTPGO_PW" >> .env
  fi
  echo "$ADMIN_PW" > /root/wog-portal-admin-password.txt
  chmod 600 /root/wog-portal-admin-password.txt
  echo "$SFTPGO_PW" > /root/wog-portal-sftpgo-password.txt
  chmod 600 /root/wog-portal-sftpgo-password.txt
  log "Admin-Passwort in /root/wog-portal-admin-password.txt"
  log "SFTPGo-Passwort in /root/wog-portal-sftpgo-password.txt"
fi

# Bestehende .env absichern (keine Passwort-Resets bei Redeploy)
ensure_env() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" .env; then
    echo "${key}=${value}" >> .env
    log ".env ergänzt: ${key}"
  fi
}
ensure_env "SEED_RESET_ADMIN_PASSWORD" "false"
# Nach dem allerersten Deploy Flag wieder auf false drehen, damit Redeploys das Admin-PW nicht überschreiben
if grep -q '^SEED_RESET_ADMIN_PASSWORD=true$' .env && [[ -f /root/wog-portal-admin-password.txt ]]; then
  # Beim ersten erfolgreichen Seed einmal true, danach dauerhaft false
  if [[ -f /root/wog-portal-seed-initialized ]]; then
    sed -i "s|^SEED_RESET_ADMIN_PASSWORD=.*|SEED_RESET_ADMIN_PASSWORD=false|" .env
  fi
fi
if ! grep -q '^SFTPGO_ADMIN_PASSWORD=.\+' .env; then
  SFTPGO_PW=$(openssl rand -base64 18)
  if grep -q '^SFTPGO_ADMIN_PASSWORD=' .env; then
    sed -i "s|^SFTPGO_ADMIN_PASSWORD=.*|SFTPGO_ADMIN_PASSWORD=$SFTPGO_PW|" .env
  else
    echo "SFTPGO_ADMIN_PASSWORD=$SFTPGO_PW" >> .env
  fi
  echo "$SFTPGO_PW" > /root/wog-portal-sftpgo-password.txt
  chmod 600 /root/wog-portal-sftpgo-password.txt
  log "SFTPGo-Admin-Passwort erzeugt → /root/wog-portal-sftpgo-password.txt"
fi

mkdir -p data/uploads \
  data/sftp/inbound/soloplan \
  data/sftp/inbound/soloplan/business-partners \
  data/sftp/inbound/soloplan/tours \
  data/sftp/inbound/intouch/meldungen \
  data/sftp/inbound/intouch/dokumente \
  data/sftp/outbound/soloplan/orders \
  data/sftp/outbound/soloplan/telematics \
  data/sftp/inbound/vlbportal/telematics \
  data/sftp/inbound/proforma \
  data/sftp/inbound/wareneingang/rechnungen \
  data/sftp/inbound/wareneingang/listen \
  data/sftp/inbound/wareneingang/ladelisten \
  data/integrations/ldv/{in,out} \
  data/integrations/mercurio/{in,out} \
  data/integrations/soloplan/{in,out} \
  data/integrations/soloplan/business-partners/{in,out} \
  data/integrations/soloplan/orders/{out,processed}

log "Docker Compose: nur Projekt $COMPOSE_PROJECT_NAME starten"
docker compose up -d --build postgres redis
sleep 5
# Zuerst Images bauen – migrate/seed müssen die neuen prisma/migrations aus dem Image sehen
docker compose build api worker web
# Kernstack inkl. SFTPGo (restart: unless-stopped) – nach Docker-Crash wieder hoch
docker compose up -d api worker web sftpgo
docker compose run --rm --no-deps api sh -c "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts" || \
  docker compose run --rm --no-deps api sh -c "npx prisma migrate deploy && npm run prisma:seed"
touch /root/wog-portal-seed-initialized
# Nach erstem Seed: Admin-Passwort bei künftigen Deploys nicht mehr überschreiben
if grep -q '^SEED_RESET_ADMIN_PASSWORD=' .env; then
  sed -i "s|^SEED_RESET_ADMIN_PASSWORD=.*|SEED_RESET_ADMIN_PASSWORD=false|" .env
else
  echo "SEED_RESET_ADMIN_PASSWORD=false" >> .env
fi
# API nach Seed neu starten (Schema ggf. geändert)
docker compose up -d api worker

if [[ "$ENABLE_SFTP" == "1" ]]; then
  # Primär: OpenSSH internal-sftp auf Port 22 (Soloplan-Firewall oft nur 22)
  # Optional zusätzlich: SFTPGo auf 12022
  log "Soloplan-SFTP auf Port 22 (OpenSSH internal-sftp)"
  SFTP_ROOT="${APP_DIR}/portal/data/sftp"
  mkdir -p \
    "$SFTP_ROOT/inbound/soloplan/business-partners" \
    "$SFTP_ROOT/inbound/soloplan/tours" \
    "$SFTP_ROOT/inbound/intouch/meldungen/processed" \
    "$SFTP_ROOT/inbound/intouch/dokumente/processed" \
    "$SFTP_ROOT/inbound/vlbportal/telematics" \
    "$SFTP_ROOT/outbound/soloplan/orders" \
    "$SFTP_ROOT/outbound/soloplan/telematics" \
    "$SFTP_ROOT/outbound/soloplan/archive"
  chown root:root "$SFTP_ROOT"
  chmod 755 "$SFTP_ROOT"
  find "$SFTP_ROOT" -type d -exec chmod 755 {} \;
  find "$SFTP_ROOT" -type f -exec chmod 644 {} \; 2>/dev/null || true
  # Upload- und Pickup-Ordner beschreibbar für SFTP-User soloplan
  # (Outbound muss löschbar sein – Soloplan entfernt Dateien nach Import)
  if id soloplan >/dev/null 2>&1; then
    chown -R soloplan:soloplan \
      "$SFTP_ROOT/inbound/soloplan" \
      "$SFTP_ROOT/inbound/intouch" \
      "$SFTP_ROOT/inbound/vlbportal" \
      "$SFTP_ROOT/inbound/proforma" \
      "$SFTP_ROOT/inbound/wareneingang" \
      "$SFTP_ROOT/outbound/soloplan/orders" \
      "$SFTP_ROOT/outbound/soloplan/telematics" \
      "$SFTP_ROOT/outbound/soloplan/archive" \
      2>/dev/null || true
    chmod 775 \
      "$SFTP_ROOT/inbound/proforma" \
      "$SFTP_ROOT/inbound/wareneingang" \
      "$SFTP_ROOT/inbound/wareneingang/rechnungen" \
      "$SFTP_ROOT/inbound/wareneingang/listen" \
      "$SFTP_ROOT/inbound/wareneingang/ladelisten" \
      "$SFTP_ROOT/outbound/soloplan/orders" \
      "$SFTP_ROOT/outbound/soloplan/telematics" \
      "$SFTP_ROOT/outbound/soloplan/archive" \
      2>/dev/null || true
  fi

  if [[ ! -f /root/wog-soloplan-sftp.txt ]]; then
    SOLOPLAN_SFTP_PW="$(openssl rand -base64 14 | tr -d '\n=/+')"
    cat > /root/wog-soloplan-sftp.txt <<EOF
user=soloplan
password=$SOLOPLAN_SFTP_PW
host=$DOMAIN
port=22
path=outbound/soloplan/orders
protocol=SFTP
EOF
    chmod 600 /root/wog-soloplan-sftp.txt
  else
    SOLOPLAN_SFTP_PW="$(grep '^password=' /root/wog-soloplan-sftp.txt | cut -d= -f2-)"
    # Port auf 22 normalisieren (früher 12022)
    if grep -q '^port=' /root/wog-soloplan-sftp.txt; then
      sed -i 's|^port=.*|port=22|' /root/wog-soloplan-sftp.txt
    else
      echo 'port=22' >> /root/wog-soloplan-sftp.txt
    fi
    grep -q '^protocol=' /root/wog-soloplan-sftp.txt || echo 'protocol=SFTP' >> /root/wog-soloplan-sftp.txt
  fi

  if ! id soloplan >/dev/null 2>&1; then
    useradd --system --home-dir "$SFTP_ROOT" --shell /usr/sbin/nologin \
      --comment "WOG Soloplan SFTP" soloplan
  fi
  echo "soloplan:${SOLOPLAN_SFTP_PW}" | chpasswd
  chown -R soloplan:soloplan \
    "$SFTP_ROOT/inbound/soloplan" \
    "$SFTP_ROOT/inbound/intouch" \
    "$SFTP_ROOT/inbound/vlbportal" \
    "$SFTP_ROOT/inbound/proforma" \
    "$SFTP_ROOT/inbound/wareneingang" \
    "$SFTP_ROOT/outbound/soloplan/orders" \
    "$SFTP_ROOT/outbound/soloplan/telematics" \
    "$SFTP_ROOT/outbound/soloplan/archive" \
    2>/dev/null || true
  chmod 775 \
    "$SFTP_ROOT/inbound/proforma" \
    "$SFTP_ROOT/inbound/wareneingang" \
    "$SFTP_ROOT/inbound/wareneingang/rechnungen" \
    "$SFTP_ROOT/inbound/wareneingang/listen" \
    "$SFTP_ROOT/inbound/wareneingang/ladelisten" \
    "$SFTP_ROOT/outbound/soloplan/orders" \
    "$SFTP_ROOT/outbound/soloplan/telematics" \
    "$SFTP_ROOT/outbound/soloplan/archive" \
    2>/dev/null || true

  if ! grep -q '^Match User soloplan$' /etc/ssh/sshd_config; then
    cat >> /etc/ssh/sshd_config <<'EOF'

# WOG Portal – Soloplan Order-Pickup (SFTP on port 22)
Match User soloplan
    ChrootDirectory /opt/wog-portal/portal/data/sftp
    ForceCommand internal-sftp
    PasswordAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
  fi
  sshd -t
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  log "SFTP-User soloplan auf Port 22 bereit (Credentials: /root/wog-soloplan-sftp.txt)"

  log "SFTPGo User/Admin absichern (Port 12022, läuft bereits mit Kernstack)"
  if [[ ! -f /root/wog-sftpgo-admin-password.txt ]]; then
    openssl rand -base64 18 | tr -d '\n' > /root/wog-sftpgo-admin-password.txt
    chmod 600 /root/wog-sftpgo-admin-password.txt
  fi
  SFTPGO_ADMIN_PASSWORD="$(cat /root/wog-sftpgo-admin-password.txt)"
  export SFTPGO_ADMIN_PASSWORD
  if grep -q '^SFTPGO_ADMIN_PASSWORD=' .env 2>/dev/null; then
    sed -i "s|^SFTPGO_ADMIN_PASSWORD=.*|SFTPGO_ADMIN_PASSWORD=$SFTPGO_ADMIN_PASSWORD|" .env
  else
    echo "SFTPGO_ADMIN_PASSWORD=$SFTPGO_ADMIN_PASSWORD" >> .env
  fi
  docker compose up -d sftpgo
  sleep 5
  TOKEN="$(curl -sS -u "admin:${SFTPGO_ADMIN_PASSWORD}" \
    'http://127.0.0.1:18080/api/v2/token' | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null || true)"
  if [[ -n "$TOKEN" ]]; then
    curl -sS -X POST 'http://127.0.0.1:18080/api/v2/users' \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d "{\"status\":1,\"username\":\"soloplan\",\"password\":\"${SOLOPLAN_SFTP_PW}\",\"home_dir\":\"/srv/sftpgo/data\",\"permissions\":{\"/\":[\"list\",\"download\"]}}" \
      >/dev/null || true
  fi
fi

# Nginx: NUR eigener vHost für $DOMAIN – keine anderen Sites anfassen.
# Bestehende Let's-Encrypt-SSL-Blöcke nicht zerstören.
NGINX_SITE="/etc/nginx/sites-available/wog-portal"
CERT_LIVE="/etc/letsencrypt/live/$DOMAIN"
HAS_CERT=0
if [[ -f "$CERT_LIVE/fullchain.pem" && -f "$CERT_LIVE/privkey.pem" ]]; then
  HAS_CERT=1
fi

log "Nginx-vHost nur für $DOMAIN schreiben ($NGINX_SITE)"
if [[ "$HAS_CERT" == "1" ]]; then
  cat > "$NGINX_SITE" <<EOF
# WOG Kundenportal – isolierter vHost
server {
    server_name $DOMAIN;
    client_max_body_size 50M;

    # Security-Header (Portal öffentlich, API nur über Auth)
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location /api/ {
        proxy_pass http://127.0.0.1:${WOG_API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:${WOG_WEB_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    listen [::]:443 ssl;
    listen 443 ssl;
    ssl_certificate $CERT_LIVE/fullchain.pem;
    ssl_certificate_key $CERT_LIVE/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if (\$host = $DOMAIN) {
        return 301 https://\$host\$request_uri;
    }
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 404;
}
EOF
else
  cat > "$NGINX_SITE" <<EOF
# WOG Kundenportal – isolierter vHost
# Andere Sites in sites-enabled bleiben unverändert.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:${WOG_API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:${WOG_WEB_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
fi

ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/wog-portal
# default-Site NICHT deaktivieren – Bestand bleibt
nginx -t
systemctl reload nginx

if [[ "$ENABLE_CERTBOT" == "1" && "$HAS_CERT" != "1" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx || true
  fi
  # Nur Zertifikat für diese eine Domain – andere Domains unberührt
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect || \
    log "Certbot übersprungen/fehlgeschlagen – HTTP bleibt aktiv"
elif [[ "$HAS_CERT" == "1" ]]; then
  log "Bestehendes TLS-Zertifikat für $DOMAIN beibehalten"
fi

echo
log "Deploy fertig (bestehende Dienste nicht gestoppt)"
docker compose ps
echo "Portal: https://$DOMAIN"
echo "Health: https://$DOMAIN/api/health"
if [[ -f /root/wog-portal-admin-password.txt ]]; then
  echo "Admin: admin@wog.logistikberater.at / (siehe /root/wog-portal-admin-password.txt)"
fi
