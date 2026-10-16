# Soloplan OrderImportPORTAL v6 – Auftrags-Export (File/FTP)

Das Portal legt bei jeder Sendungserfassung einen **Auftrag** (`TransportOrder`) an und exportiert JSON im Format **SoloplanOrderImportPORTAL v6** (File-API). Soloplan braucht **mindestens einen Auftrag mit einer Sendung**.

## Auftrag im Portal

- Bei `POST /shipments` wird automatisch ein Auftrag erzeugt.
- **Externe Nummer:** `VLB` + Tag(TT) + Monat(MM) + 5-stellige Sequenz  
  Beispiel: `VLB200700001` (20.07., erste Nummer des Tages).
- **Frachtzahler** (`order.customer`): immer der **eingeloggte Kunde** (`user.customerId`).  
  Admin ohne Kundenkonto: Fallback auf den Sendungskunden.

## Dateiformat (Standard: Order)

```json
{
  "header": { "sendDate": "...", "exportItemReference": "..." },
  "order": [
    {
      "externalNumber": "VLB200700001",
      "customer": { "number": 2, "name1": "…" },
      "consignments": [ { "externalNumber": "…", "sender": {}, "receiver": {} } ]
    }
  ]
}
```

Optional nur Sendung (`SOLOPLAN_FILE_FORMAT=consignment`) – für Soloplan nicht empfohlen.

Referenz-Schemas und Samples:

- `docs/soloplan/order-import-portal-v6/schemas/`
- `docs/soloplan/order-import-portal-v6/samples/`
- `portal/data/samples/soloplan-orders/`

## Abholverzeichnis (FTP/SFTP)

| Pfad im Container / auf dem Server | Zweck |
|------------------------------------|--------|
| `portal/data/sftp/outbound/soloplan/orders/` | **Pickup** für Soloplan (SFTP) |
| `portal/data/sftp/outbound/soloplan/archive/` | Nach Download automatisch hierher verschoben |
| `portal/data/integrations/soloplan/orders/out/` | Spiegelkopie (aktiv) |
| `portal/data/integrations/soloplan/orders/processed/` | Spiegel nach Download |

Dateiname: `{Sendungsnummer oder Referenz}.json` (Consignment) bzw. `order-{…}.json` (Order).

Nach erfolgreichem SFTP-Download (Datei wurde gelesen) verschiebt der Worker die JSON nach ca. 20 s aus dem Pickup-Ordner nach `outbound/soloplan/archive/` (Spiegel nach `integrations/.../processed/`). Steuertbar über `SOLOPLAN_ARCHIVE_DELAY_SEC`.

### SFTP

Wenn SFTP aktiv ist (`ENABLE_SFTP=1`):

- Host: `wog.logistikberater.at`
- Port: **`22`** (OpenSSH internal-sftp, empfohlen für Soloplan)
- User: `soloplan` (Credentials: `/root/wog-soloplan-sftp.txt`)
- Remote-Pfad: `outbound/soloplan/orders/`
- Optional zusätzlich: SFTPGo auf Port `12022` (gleicher User/Pfad)

```bash
sftp soloplan@wog.logistikberater.at
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
SOLOPLAN_FILE_FORMAT=order
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

| Portal | Soloplan |
|--------|----------|
| `TransportOrder.externalNumber` (VLB…) | `order[].externalNumber` |
| Eingeloggter Kunde (Frachtzahler) | `order[].customer` |
| Default-Sender BP 2 / WOG | `consignments[].sender` |
| Abholadresse | `consignments[].differentLoadingPoint` |
| Zustelladresse | `consignments[].receiver` |
| Sendungsreferenz / Tracking | `consignments[].externalNumber` |
| Positionen / Gewicht | `consignmentItems` / `weights` |

## REST (optional)

`SOLOPLAN_MODE=rest` + `SOLOPLAN_BASE_URL` + `SOLOPLAN_API_KEY` postet gegen:

- `/api/SoloplanOrderImportPORTAL/v6/Consignment`
- `/api/SoloplanOrderImportPORTAL/v6/Order`
