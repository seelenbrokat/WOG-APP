# WOG Logistics App & Portal

## Bestandteile

- `app/` – Android Scan-App (bestehend)
- `portal/` – Kunden- und Partnerportal (Web + API)
- `docs/` – Architektur, Deployment, Soloplan, Handbuch

Zugang: `https://wog.logistikberater.at` (nach Deployment)

## Dokumentation (Portal)

| Doc | Inhalt |
|-----|--------|
| [docs/HANDBUCH.md](docs/HANDBUCH.md) | Alle Bereiche, Rollen, Zollflags, Smoke-Checkliste |
| [docs/PROD_BASELINE.md](docs/PROD_BASELINE.md) | Baseline, Sicherung, Patch- & Deploy-Prozess |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Server-Install / Nginx |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Komponenten & Rollen |

Sicherung vor Änderungen: `portal/scripts/backup-local.sh`  
Deploy aus Git: `portal/scripts/deploy-from-git.sh`
