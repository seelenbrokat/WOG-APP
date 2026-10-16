# Zustell-App API (Fahrer)

Die Fahrer-/Zustell-App spricht die **Portal-API** an – nicht `api.logistikberater.at/wog` (Platzhalter).

## Wichtig für Deploys
Die App-API liegt im Portal-Repo unter `apps/api/src/fahrer/`.  
**Nicht** nach `/opt/wog-portal` aus einem separaten Fahrer-Deploy kopieren – das überschreibt Portal-Code.

## Zugriff
| Weg | Details |
|-----|---------|
| Basis | `https://wog.logistikberater.at/api` |
| PIN-Login | `POST /fahrer/auth/pin` |
| QR-Login | `POST /fahrer/auth/qr` |
| Refresh | `POST /fahrer/auth/refresh` |
| Fahrzeuge (öffentlich) | `GET /fahrer/vehicles` |
| Session | `GET /fahrer/me` (Bearer Driver-JWT) |
| Touren | `GET /fahrer/tours`, `GET /fahrer/tours/:tourNumber` |
| Telematik | `POST /fahrer/telematics/*` |
| Live-ETA | `POST /fahrer/telematics/eta` |
| Chat | `GET/POST /fahrer/chat` |
| SmartBorder | `GET /fahrer/smartborder/status` |

Telematikconfig: **VLBPortal** · VehicleId = Soloplan-Fahrzeug-ID · DriverId = TelematicsId (z. B. THNE)

## Live-ETA (`POST /fahrer/telematics/eta`)

Strukturierte ETA für Dispo + Endkunde im Portal:

```json
{
  "tourNumber": "184200",
  "text": "Erwartete Zustellung Tour 184200: ca. 23:41 (Fahrzeit 2 Std. 4 Min + 2×15 Min Stop)",
  "etaAt": "2026-07-26T21:41:00.000Z"
}
```

Zusätzlich werden ETA-Texte aus `POST /fahrer/chat` und Location-`information` erkannt und gespeichert (nur bei Änderung).

## Tour-Detail (`GET /fahrer/tours/:tourNumber`)

Liefert die Tour inkl. aller verfügbaren Sendungsinformationen aus Soloplan:

- **Stops:** Adresse, Geo, Zeitfenster, Aktivität, Telefon, Zusatzzeilen (`remarksLines`)
- **Consignments / Sendungen:**
  - `sendungsnummer` (`OrderNumber.ConsignmentIndex`)
  - Absender / Empfänger / Auftraggeber inkl. Adresse, Kontakt, Öffnungszeiten
  - Freight (Gewicht, Menge, LDM, Inhalt, Verpackung, …)
  - geplante Belade-/Entladefenster
  - Hinweise (`remarks.senderInformation*`, `receiverInformation`)
  - Items inkl. SSCC-Liste (`items`, `ssccs`)
  - Referenzen, CheckFields, Lademittel
  - Rohobjekt `details` mit allen geparsten Extrafeldern
- **Documents:** zugehörige Tour-Dokumente (POD etc.)

Liste (`GET /fahrer/tours`) enthält zusätzlich `previewConsignments` mit Sendungsnummer und Empfänger.

## Dispo
- Portal: `/fahrer` (Stammdaten / Bootstrap)
- QR erzeugen: `POST /fahrer/auth/qr-create` (ORG_ADMIN / MANDANT_DISPATCHER)
- Admin Telematik: `GET /fahrer/telematics/status`, `POST /fahrer/telematics/process-inbound`
