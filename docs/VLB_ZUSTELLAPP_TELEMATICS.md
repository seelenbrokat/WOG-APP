# VLB-Zustellapp → Soloplan Telematik (FTP)

Telematikkonfiguration: **VLBPortal**  
VehicleId: echte Soloplan-Fahrzeug-ID (z. B. `103`)

## Soloplan-Download (SFTP)

| Pfad | Inhalt |
|------|--------|
| `outbound/soloplan/telematics/` | StdTelematics-XML aus der Zustellapp |
| `outbound/soloplan/orders/` | Auftrags-JSON (unverändert) |

Optional App-Upload (Worker spiegelt nach Outbound):

| Pfad | Inhalt |
|------|--------|
| `inbound/vlbportal/telematics/` | Roh-XML von der App → Portal bucht + legt nach Outbound |

## REST-API (Portal)

Basis: `/api/fahrer/telematics`  
Rollen: `ORG_ADMIN`, `MANDANT_DISPATCHER`, `PARTNER`

| Methode | Pfad | Wirkung |
|---------|------|---------|
| `GET` | `/status` | Outbound-Pfad, Config |
| `GET` | `/outbound` | Pending XML-Dateien |
| `POST` | `/tour-status` | TourStatus → FTP |
| `POST` | `/tour-stop-status` | TourStopStatus + **Lademittel** → FTP + Portal-Buchung |
| `POST` | `/transport-order-status` | TransportOrderStatus → FTP |
| `POST` | `/document` | POD/Unterschrift → FTP; bei Signatur **Ablieferbeleg** inkl. Lademittel |
| `POST` | `/sscc-status` | SsccStatus → FTP |
| `POST` | `/process-inbound` | `inbound/vlbportal/telematics` manuell verarbeiten |

### TourStopStatus mit Lademittel (Beispiel)

```json
{
  "vehicleId": "103",
  "driverId": "THNE",
  "tourNumber": "184395",
  "tourStopId": "166244650",
  "status": "Other",
  "loadingUnitExchanges": [
    { "matchcode": "EUP", "given": 5, "taken": 5 }
  ]
}
```

### Document / Unterschrift

```json
{
  "vehicleId": "103",
  "tourNumber": "184395",
  "transportOrderNumber": "…",
  "tourStopId": "…",
  "fileName": "Signature_UnloadingStation.jpg",
  "contentBase64": "…",
  "signedByName": "Max Muster"
}
```

Erzeugt:

1. StdTelematics `Document` im FTP-Outbound  
2. Sauberen **Ablieferbeleg-PDF** (Portal-Dokument `ABLIEFERBELEG`) mit Signatur + Lademittel  
3. Ablieferbeleg zusätzlich als StdTelematics-Document im FTP  
4. Soloplan Order-Update mit `documentData` (wenn Auftrag bereits exportiert/importiert)
