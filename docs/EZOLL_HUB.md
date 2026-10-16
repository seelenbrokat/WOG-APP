# EZOLL-Integrationshub: Soloplan ↔ LDV ↔ Mercurio

Interne Drehscheibe im WOG-Portal für den Datenaustausch zwischen:

| System | Rolle |
|--------|--------|
| **Soloplan / CarLo** | TMS / Transportplanung |
| **LDV** | Zollprogramm |
| **Mercurio** | Zollprogramm |

## Unterstützte Richtungen

- Soloplan → LDV
- Soloplan → Mercurio
- LDV → Soloplan
- Mercurio → Soloplan
- LDV → Mercurio
- Mercurio → LDV

UI: **EZOLL-Hub** (`/integrations`) – nur Admin/Disposition.

## Kanonisches Austauschformat

Alle Adapter sprechen intern dasselbe JSON (`exchangeVersion: 1.0`):

```json
{
  "exchangeVersion": "1.0",
  "reference": "CUSTOMS-W-ABC123-xyz",
  "sourceSystem": "SOLOPLAN",
  "targetSystem": "LDV",
  "kennzeichen": "W-ABC123",
  "grenzuebergang": "Nickelsdorf / Hegyeshalom",
  "zeit": "2026-07-16T08:30:00.000Z",
  "importeur": "Import Demo GmbH",
  "customsOrderId": "...",
  "shipmentTrackingNumber": "...",
  "mandantCode": "AG",
  "customerNumber": "K-10001",
  "status": "SUBMITTED",
  "raw": {}
}
```

Feldmappings für LDV/Mercurio-Native-Formate werden ergänzt, sobald die Herstellerdokumentation vorliegt (`raw` hält Rohdaten zwischen).

## Betriebsmodi je System

| Env | Bedeutung |
|-----|-----------|
| `LDV_ENABLED` / `MERCURIO_ENABLED` / `SOLOPLAN_CUSTOMS_ENABLED` | Adapter aktiv |
| `*_MODE=stub` | Nur Logik-/Testantwort (Standard) |
| `*_MODE=file` | Datei nach `INTEGRATION_DIR/{system}/out` |
| `*_MODE=rest` | HTTP an `*_BASE_URL` |

Ordner für File-Modus:

```
data/integrations/
  ldv/in|out
  mercurio/in|out
  soloplan/in|out
```

Inbox-Dateien (`*.json`) werden vom Worker alle 30 s (oder manuell „Inbox abholen“) gelesen und als Transfer in die Gegenrichtung verarbeitet.

## Konfiguration (.env)

```env
INTEGRATION_DIR=/app/data/integrations

LDV_ENABLED=false
LDV_MODE=stub
LDV_BASE_URL=
LDV_API_KEY=

MERCURIO_ENABLED=false
MERCURIO_MODE=stub
MERCURIO_BASE_URL=
MERCURIO_API_KEY=

SOLOPLAN_CUSTOMS_ENABLED=false
SOLOPLAN_CUSTOMS_MODE=stub
```

## API

- `GET /api/integrations/hub/status`
- `GET /api/integrations/hub/transfers`
- `POST /api/integrations/hub/transfers` `{ fromSystem, toSystem, customsOrderId?, shipmentId?, reference? }`
- `POST /api/integrations/hub/transfers/:id/process`
- `POST /api/integrations/hub/poll-inbox`

## Nächster Schritt

Sobald die LDV- und Mercurio-Dokumentation vorliegt:

1. Native Mapping-Funktionen in `customs-adapters.ts` ergänzen
2. REST-Pfade/Auth an die echten Endpunkte anpassen
3. Optional: automatischer Transfer beim Anlegen eines Verzollungsauftrags
