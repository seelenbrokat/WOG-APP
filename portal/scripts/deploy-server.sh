#!/usr/bin/env bash
# Deployment auf dem Zielserver (wog.logistikberater.at / 85.215.41.99)
# Aufruf auf dem Server:
#   curl -fsSL … | bash
# oder:
#   bash scripts/deploy-server.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wog-portal}"
REPO_URL="${REPO_URL:-https://github.com/seelenbrokat/WOG-APP.git}"
BRANCH="${BRANCH:-cursor/wog-kundenportal-203f}"
DOMAIN="${DOMAIN:-wog.logistikberater.at}"

echo "==> WOG Portal Deploy"
echo "    Dir:    $APP_DIR"
echo "    Branch: $BRANCH"
echo "    Domain: $DOMAIN"

if [[ $EUID -ne 0 ]]; then
  echo "Bitte als root ausführen (sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/portal"

if [[ ! -f .env ]]; then
  cp .env.example .env
  # Sichere Defaults setzen
  JWT=$(openssl rand -hex 32)
  ADMIN_PW=$(openssl rand -base64 12)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  sed -i "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$ADMIN_PW|" .env
  sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" .env
  sed -i "s|^API_URL=.*|API_URL=https://$DOMAIN/api|" .env
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" .env
  echo "$ADMIN_PW" > /root/wog-portal-admin-password.txt
  chmod 600 /root/wog-portal-admin-password.txt
  echo "Admin-Passwort gespeichert in /root/wog-portal-admin-password.txt"
fi

mkdir -p data/uploads data/sftp/inbound data/sftp/outbound \
  data/integrations/ldv/{in,out} \
  data/integrations/mercurio/{in,out} \
  data/integrations/soloplan/{in,out}

echo "==> Docker Compose build & start"
docker compose up -d --build postgres redis
sleep 5
docker compose run --rm api sh -c "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts" || \
  docker compose run --rm api sh -c "npx prisma migrate deploy && npm run prisma:seed"
docker compose up -d --build api worker web

# Nginx: Portal priorisiert unter / und /api, Gateway unter /gateway belassen falls vorhanden
NGINX_SITE="/etc/nginx/sites-available/wog-portal"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000/;
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

ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/wog-portal
nginx -t
systemctl reload nginx

if command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@$DOMAIN --redirect || true
else
  apt-get install -y -qq certbot python3-certbot-nginx || true
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@$DOMAIN --redirect || true
fi

echo
echo "==> Deploy fertig"
docker compose ps
echo "Portal: https://$DOMAIN"
echo "Health: https://$DOMAIN/api/health"
if [[ -f /root/wog-portal-admin-password.txt ]]; then
  echo "Admin: admin@wog.logistikberater.at / $(cat /root/wog-portal-admin-password.txt)"
fi
