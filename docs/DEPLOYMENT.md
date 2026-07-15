# Deployment – wog.logistikberater.at

## Status der Infrastruktur

- DNS `wog.logistikberater.at` zeigt auf `85.215.41.99` (SSH Port 22 offen).
- Derzeit läuft dort ein API-Gateway (`api.logistikberater.at`); Produkt `wog` ist noch `planned`.
- Für den Deploy braucht der Agent **SSH-Zugang** (Deploy-Key oder User/Passwort).

## One-Shot Deploy (auf dem Server als root)

```bash
# Variante A: Repo ist bereits da
cd /opt/wog-portal/portal && bash scripts/deploy-server.sh

# Variante B: frisch vom GitHub-Branch
curl -fsSL https://raw.githubusercontent.com/seelenbrokat/WOG-APP/cursor/wog-kundenportal-203f/portal/scripts/deploy-server.sh | bash
```

Das Skript installiert bei Bedarf Docker, baut den Stack, migriert/seedet die DB und richtet Nginx (+ optional Certbot) für `wog.logistikberater.at` ein.

## Manuell

```bash
cd portal
cp .env.example .env
# JWT_SECRET, SMTP_*, SEED_ADMIN_PASSWORD setzen

docker compose up -d postgres redis
docker compose run --rm api sh -c "npx prisma migrate deploy && npm run prisma:seed"
docker compose up -d --build api worker web sftpgo
```

Nginx-Beispiel: [portal/nginx/wog.conf.example](../portal/nginx/wog.conf.example)

## Benötigte Angaben für Remote-Deploy durch den Cloud-Agenten

1. SSH-Host (falls nicht `wog.logistikberater.at` / `85.215.41.99`)
2. SSH-User (z. B. `root` oder `deploy`)
3. Entweder:
   - privater SSH-Key (Deploy-Key mit Schreibrechten auf dem Server), **oder**
   - einmaliges Passwort / sudo
4. Bestätigung: Soll das bestehende Gateway unter `/` durch das Kundenportal ersetzt werden, oder Portal unter Pfad/Subdomain (z. B. `/portal`)?

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
