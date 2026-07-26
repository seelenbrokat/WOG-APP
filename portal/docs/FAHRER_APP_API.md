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
| Chat | `GET/POST /fahrer/chat` |
| SmartBorder | `GET /fahrer/smartborder/status` |

Telematikconfig: **VLBPortal** · VehicleId = Soloplan-Fahrzeug-ID · DriverId = TelematicsId (z. B. THNE)

## Dispo
- Portal: `/fahrer` (Stammdaten / Bootstrap)
- QR erzeugen: `POST /fahrer/auth/qr-create` (ORG_ADMIN / MANDANT_DISPATCHER)
- Admin Telematik: `GET /fahrer/telematics/status`, `POST /fahrer/telematics/process-inbound`
