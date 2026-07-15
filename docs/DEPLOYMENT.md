# Deployment – wog.logistikberater.at

## Voraussetzungen

- Docker + Docker Compose auf dem Server `logistikberater.at`
- DNS A-Record: `wog.logistikberater.at` → Server-IP
- Nginx (oder Caddy) als Reverse Proxy
- SMTP-Zugangsdaten für E-Mail-Benachrichtigungen

## Schnellstart

```bash
cd portal
cp .env.example .env
# JWT_SECRET, SMTP_*, SEED_ADMIN_PASSWORD setzen

docker compose up -d postgres redis
# Migration + Seed einmalig:
docker compose run --rm api sh -c "npx prisma migrate deploy && npx prisma db seed"

docker compose up -d api worker web sftpgo
```

Nginx-Beispiel: [portal/nginx/wog.conf.example](../portal/nginx/wog.conf.example)

TLS mit Let’s Encrypt:

```bash
certbot --nginx -d wog.logistikberater.at
```

## Ports (intern)

| Dienst | Port |
|--------|------|
| Web | 3000 |
| API | 3001 |
| Postgres | 5432 |
| Redis | 6379 |
| SFTPGo SFTP | 2022 |
| SFTPGo Admin | 8080 |

Öffentlich nur 80/443 über Nginx freigeben.

## Seed-Zugänge (Standard)

| Rolle | E-Mail | Passwort |
|-------|--------|----------|
| Admin | `admin@wog.logistikberater.at` | laut `SEED_ADMIN_PASSWORD` |
| Dispo AG | `dispatch.ag@wog.logistikberater.at` | `DispatchAg123!` |
| Dispo GmbH | `dispatch.gmbh@wog.logistikberater.at` | `DispatchGmbh123!` |
| Kunde | `kunde@example.com` | `Kunde123!` |

Demo-Tracking: `WOGDEMO0001` / PIN `1234`

## Partner-FTP

1. In SFTPGo Benutzer anlegen (Ordner auf `/srv/sftpgo/data` mappen)
2. Inbound-Dateien als `{PARTNERCODE}_*.json` nach `data/sftp/inbound` legen
3. Worker verarbeitet alle 30 Sekunden und schreibt nach `inbound/processed`

## Soloplan

Siehe [SOLOPLAN.md](./SOLOPLAN.md).

## Lokale Entwicklung ohne Docker-Build

```bash
cd portal
cp .env.example .env
# DATABASE_URL auf lokalen Postgres zeigen
npm install
npm run build -w @wog/shared
cd apps/api && npx prisma generate && npx prisma migrate dev && npm run prisma:seed
cd ../..
npm run dev:api   # Terminal 1
npm run dev:web   # Terminal 2
```
