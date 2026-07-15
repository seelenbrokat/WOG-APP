# Soloplan / CarLo Anbindung

Das Portal spricht Soloplan über das Interface `TransportIntegration` in `apps/api/src/integrations/soloplan.service.ts`.

## Modi (`SOLOPLAN_MODE`)

| Modus | Verhalten |
|-------|-----------|
| `stub` | Speichert eine Stub-Referenz `SP-STUB-…` (Standard, ohne externes System) |
| `file` | Schreibt Auftrags-JSON nach `SFTP_OUTBOUND_DIR` als `soloplan-order-{TN}.json` |
| `rest` | `POST {SOLOPLAN_BASE_URL}/orders` mit Bearer-Token `SOLOPLAN_API_KEY` |

Aktivierung: `SOLOPLAN_ENABLED=true`

## Status-Rückmeldungen (Datei)

Ablegen in `SFTP_INBOUND_DIR`:

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
SOLOPLAN_ENABLED=false
SOLOPLAN_MODE=stub
SOLOPLAN_BASE_URL=https://carlo-api.example.com
SOLOPLAN_API_KEY=
```

Die konkreten CarLo-Endpunkte und Felder von Soloplan werden kundenseitig hinterlegt; der Adapter ist bewusst austauschbar, ohne Domain-Logik zu ändern.
