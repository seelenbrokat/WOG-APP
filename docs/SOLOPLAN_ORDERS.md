# Soloplan OrderImportPORTAL v6 – Auftrags-Export (File/FTP)

Das Portal erzeugt für freigegebene Sendungen JSON-Dateien im Format **SoloplanOrderImportPORTAL v6** (File-API). Soloplan (oder du) holt die Dateien per **SFTP** oder per Portal-API ab.

## Dateiformat

Wrapper wie in der Spec:

```json
{
  "header": {
    "sendDate": "2026-07-20T19:36:01",
    "exportItemReference": "<uuid>"
  },
  "consignment": [ { "...": "..." } ]
}
```

Alternativ (`SOLOPLAN_FILE_FORMAT=order`):

```json
{
  "header": { "sendDate": "...", "exportItemReference": "..." },
  "order": [ { "externalNumber": "...", "customer": {}, "consignments": [ ... ] } ]
}
```

Referenz-Schemas und Samples:

- `docs/soloplan/order-import-portal-v6/schemas/`
- `docs/soloplan/order-import-portal-v6/samples/`
- `portal/data/samples/soloplan-orders/`

## Abholverzeichnis (FTP/SFTP)

| Pfad im Container / auf dem Server | Zweck |
|------------------------------------|--------|
| `portal/data/sftp/outbound/soloplan/orders/` | **Pickup** für Soloplan (SFTP) |
| `portal/data/integrations/soloplan/orders/out/` | Spiegelkopie |

Dateiname: `{Sendungsnummer oder Referenz}.json` (Consignment) bzw. `order-{…}.json` (Order).

### SFTP

Wenn SFTPGo aktiv ist (`ENABLE_SFTP=1`):

- Host: `wog.logistikberater.at`
- Port: `12022` (SFTP)
- User: `soloplan` (siehe Server: `/root/wog-soloplan-sftp.txt`)
- Remote-Pfad: `outbound/soloplan/orders/`

```bash
sftp -P 12022 soloplan@wog.logistikberater.at
cd outbound/soloplan/orders
ls
get *.json
```

### Portal-API

```http
GET  /api/integrations/soloplan/status
GET  /api/integrations/soloplan/orders
GET  /api/integrations/soloplan/orders/{fileName}/download
POST /api/integrations/soloplan/shipments/{shipmentId}/export
```

Rollen: `ORG_ADMIN`, `MANDANT_DISPATCHER`

## Wann wird exportiert?

- Automatisch, wenn eine Sendung auf Status `SUBMITTED` geht (Worker, alle 30 s)
- Manuell: `POST /api/integrations/soloplan/shipments/{id}/export`

## Konfiguration

```env
SOLOPLAN_ENABLED=true
SOLOPLAN_MODE=file
SOLOPLAN_FILE_FORMAT=consignment
SOLOPLAN_ORDERS_OUT_DIR=/app/data/sftp/outbound/soloplan/orders
SOLOPLAN_OBJECT_OWNER_ID=2
SOLOPLAN_DEFAULT_SENDER_BP=2
SOLOPLAN_DEFAULT_SENDER_MATCHCODE=WOGDIEPO
SOLOPLAN_DEFAULT_SENDER_NAME=WOG Logistics AG
SOLOPLAN_DEFAULT_SENDER_STREET=Wildenaustraße 22
SOLOPLAN_DEFAULT_SENDER_ZIP=9444
SOLOPLAN_DEFAULT_SENDER_CITY=Diepoldsau
SOLOPLAN_DEFAULT_SENDER_COUNTRY=CH
```

Mapping (Kurz):

| Portal | Soloplan Consignment |
|--------|----------------------|
| Kunde / Default-Sender BP 2 | `sender` (+ MasterData) |
| Abholadresse | `differentLoadingPoint` |
| Zustelladresse | `receiver` |
| Referenz / Tracking | `externalNumber` |
| Positionen / Gewicht | `consignmentItems` / `weights` |
| Abhol-/Zustelldatum | `times.*` |

## REST (optional)

`SOLOPLAN_MODE=rest` + `SOLOPLAN_BASE_URL` + `SOLOPLAN_API_KEY` postet gegen:

- `/api/SoloplanOrderImportPORTAL/v6/Consignment`
- `/api/SoloplanOrderImportPORTAL/v6/Order`
