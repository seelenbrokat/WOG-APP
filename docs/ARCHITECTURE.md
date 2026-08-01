# Architektur – WOG Kundenportal

## Überblick

Das Portal unter `portal/` ist die Drehscheibe für Kunden und Partner der **WOG Logistics**.

- **Organisation:** WOG Logistics
- **Mandanten:** WOG AG (`AG`), WOG GmbH (`GMBH`)
- **Kunden:** gehören zur Organisation und können Aufträge an beide Mandanten erteilen
- **Sichtbarkeit:** Disponenten/Partner sehen nur freigegebene Mandanten; AG-Sendungen bleiben bei AG, GmbH-Sendungen bei GmbH

## Komponenten

| Service | Rolle |
|---------|--------|
| `apps/web` | Next.js Kunden-/Admin-UI |
| `apps/api` | NestJS REST-API |
| Worker | Partner-FTP-Import + Soloplan-Sync |
| PostgreSQL | Persistenz (Prisma) |
| Redis | vorbereitet für Queues/Caching |
| SFTPGo | FTP/SFTP für Partnerschnittstellen |

## Rollen

- `ORG_ADMIN` – volle Organisationsverwaltung
- `MANDANT_DISPATCHER` – nur zugewiesene Mandanten
- `CUSTOMER_USER` – eigene Aufträge an AG/GmbH, Dokumente, POD
- `PARTNER` – Partnerkanal / API-Key

## Kern-Endpunkte

- `POST /api/auth/register|login|verify-email|forgot-password|reset-password`
- `GET/POST /api/shipments`, `PATCH /api/shipments/:id/status`
- `GET /api/tracking?tn=&pin=` (öffentlich)
- `POST /api/documents/upload`, `POST /api/documents/ablieferbeleg/:shipmentId`
- `GET/POST /api/customers`, `/api/mandanten`, `/api/partners`, `/api/users`

Die bestehende Android-App unter `/app` bleibt unverändert und kann später an dieselbe API angebunden werden.
