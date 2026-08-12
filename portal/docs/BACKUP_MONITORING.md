# Backup & Monitoring – WOG Portal

## Soloplan / Integrationen

Security-Härtung betrifft Auth, Track & Trace und Exponierung – **nicht** den Soloplan-/Wareneingangs-Import.
Status, OrderNumber, Dokumente und Telematik laufen weiter über die bestehenden SFTP-/Worker-Pfade (`data/sftp`, Worker-Jobs).

## Einmal-Passwörter für User

1. Admin legt User unter **Benutzerverwaltung** an (oder setzt Passwort zurück).
2. API erzeugt ein **zufälliges Einmal-Passwort**.
3. User erhält es **per E-Mail**; Admin sieht es **einmalig** im Portal (Kopieren möglich).
4. Beim ersten Login erzwingt die API die Passwortänderung (`mustChangePassword`).

Kein gemeinsames Default-Passwort mehr.

## Backup

Skript: `portal/scripts/backup-portal.sh`

Enthält:

- Postgres-Dump (`pg_dump` custom format)
- Tar von `data/uploads`, `data/sftp`, `data/integrations`
- Retention standardmäßig **14 Tage** (`KEEP_DAYS`)

Cron auf dem VPS:

```bash
chmod +x /opt/wog-portal/portal/scripts/backup-portal.sh
mkdir -p /var/backups/wog-portal
crontab -e
# täglich 02:15 UTC
15 2 * * * /opt/wog-portal/portal/scripts/backup-portal.sh >> /var/log/wog-portal-backup.log 2>&1
```

Restore (Beispiel DB):

```bash
docker compose -p wogportal exec -T postgres \
  pg_restore -U wog -d wog_portal --clean --if-exists \
  < /var/backups/wog-portal/<STAMP>/wog_portal.dump
```

Empfehlung: Backup-Verzeichnis zusätzlich offsite kopieren (rclone/rsync auf zweiten Host).

## Monitoring

Endpoints:

| URL | Zweck |
|-----|--------|
| `/api/health` | Liveness (Prozess) |
| `/api/health/ready` | Readiness inkl. **DB-Check** |

Skript: `portal/scripts/monitor-portal.sh`

```bash
chmod +x /opt/wog-portal/portal/scripts/monitor-portal.sh
crontab -e
# alle 5 Minuten
*/5 * * * * /opt/wog-portal/portal/scripts/monitor-portal.sh >> /var/log/wog-portal-monitor.log 2>&1
```

Optional Alerts:

```bash
export MONITOR_WEBHOOK_URL='https://hooks.slack.com/services/…'
# oder
export MONITOR_MAIL_TO='ops@worldofgreen.ch'
```

Zusätzlich empfohlen: externer Uptime-Check (UptimeRobot/Hetrix/Better Stack) auf  
`https://wog.logistikberater.at/api/health/ready` alle 1–5 Minuten.
