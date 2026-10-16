# BT Swiss – Statusmeldungen per SFTP (Partnerverkehr)

Querformat AG / BT Swiss sendet Statusrückmeldungen an den WOG-SFTP.

## Zugangsdaten

| | |
|--|--|
| Protokoll | **SFTP** (SSH) |
| Host | `wog.logistikberater.at` |
| Port | `22` |
| Benutzer | `btswiss` |
| Passwort | Server `portal/data/sftp/credentials/btswiss.txt` (nicht in Git) |
| Drop-Pfad | nach Login direkt schreibbar (Chroot → `inbound/partner-status/btswiss/`) |

## Unterstützte Formate

1. **BT Swiss Cargo-Status-XML** (Live, aktuell genutzt)  
   `<status><control>…</control><shipment event="C50" … signature="…" /></status>`
2. **FORTRAS STAT512** (`@@PHSTAT512…`) – weiterhin unterstützt

### Cargo-XML Events (Auszug)

| Code | Bedeutung | Soloplan-Status | Ablieferbeleg |
|------|-----------|-----------------|---------------|
| B00 | unterwegs / Zwischenstatus | Other | nein |
| C50 | zugestellt m. Unterschrift | UnloadingFinished | ja (Signatur) |
| C56 | zugestellt m. Foto | UnloadingFinished | ja (Foto) |
| A00 | Ankunft / verwandt | LoadingPlaceArrived | bei Sig/Foto |

Status wird **auch ohne Freitext/Beschreibung** gesetzt.  
Bei `signature` oder `details/@picture` wird ein **Ablieferbeleg-PDF** erzeugt und als StdTelematics-Document an Soloplan geschickt (TIFF-Unterschriften werden nach PNG konvertiert).

## Verarbeitung

1. Datei → `inbound/partner-status/btswiss/`
2. Worker erkennt Format (XML oder STAT512)
3. Match über `shipmentreference` / `shipmentid` → TourConsignment / Shipment
4. Outbound: `outbound/soloplan/telematics/` (TransportOrderStatus + Document)

Ohne bekannte Soloplan-VehicleId: Fallback `PARTNER_STATUS_DEFAULT_VEHICLE_ID` bzw.
`BT_SWISS_DEFAULT_VEHICLE_ID`.

## Samples

- `portal/data/samples/fortras/btswiss-status-c50-sample.xml`
- `portal/data/samples/fortras/stat512-sample.txt`
