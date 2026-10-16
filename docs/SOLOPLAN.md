# Soloplan / CarLo Anbindung

Das Portal spricht Soloplan über `apps/api/src/integrations/soloplan.service.ts` und den Mapper `soloplan-order.mapper.ts` (**OrderImportPORTAL v6**).

## Auftrags-Export (File/FTP)

Siehe **[SOLOPLAN_ORDERS.md](./SOLOPLAN_ORDERS.md)** – Consignment-/Order-JSON, SFTP-Abholverzeichnis, API.

## Modi (`SOLOPLAN_MODE`)

| Modus | Verhalten |
|-------|-----------|
| `stub` | Speichert Stub-Referenz `SP-STUB-…` (ohne externes System) |
| `file` | Schreibt PORTAL-v6 JSON nach `sftp/outbound/soloplan/orders/` |
| `rest` | `POST {SOLOPLAN_BASE_URL}/api/SoloplanOrderImportPORTAL/v6/Consignment` bzw. `/Order` |

Aktivierung: `SOLOPLAN_ENABLED=true`

## Business Partner

Siehe [SOLOPLAN_BUSINESS_PARTNERS.md](./SOLOPLAN_BUSINESS_PARTNERS.md).

## Status-Rückmeldungen (Datei)

Ablegen in `SFTP_INBOUND_DIR` (oder `…/soloplan/`):

```json
{
  "trackingNumber": "WOG2607ABCDEF",
  "status": "IN_TRANSIT",
  "message": "Übergabe Hub Wien"
}
```

Dateiname: `soloplan-status-*.json`

## Konfiguration

```env
SOLOPLAN_ENABLED=true
SOLOPLAN_MODE=file
SOLOPLAN_FILE_FORMAT=consignment
SOLOPLAN_BASE_URL=
SOLOPLAN_API_KEY=
```
