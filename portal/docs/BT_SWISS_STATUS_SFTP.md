# BT Swiss – Statusmeldungen per SFTP (Partnerverkehr)

Querformat AG (Thomas Marthy) kann Statusrückmeldungen zusätzlich an den WOG-SFTP
senden. Empfangen wird **FORTRAS STAT512** (System Alliance), analog zu Quehenberger BORD512.

## Zugangsdaten (an Querformat / BT Swiss)

| | |
|--|--|
| Protokoll | **SFTP** (SSH) |
| Host | `wog.logistikberater.at` |
| Port | `22` |
| Benutzer | `btswiss` |
| Passwort | siehe Server `portal/data/sftp/credentials/btswiss.txt` (nicht in Git) |
| Drop-Pfad | nach Login direkt schreibbar (Chroot → `inbound/partner-status/btswiss/`) |
| Format | **FORTRAS STAT512** (`@@PHSTAT512…`), Encoding Latin-1 oder UTF-8 |

## Verarbeitung

1. Datei landet in `inbound/partner-status/btswiss/`
2. Worker parst Q10-Statuszeilen
3. Match über Sendungs-/Auftragsnummer → TourConsignment / Shipment
4. Soloplan **StdTelematics TransportOrderStatus** → `outbound/soloplan/telematics/`

Ohne bekannte Soloplan-VehicleId: Fallback `PARTNER_STATUS_DEFAULT_VEHICLE_ID` bzw.
`BT_SWISS_DEFAULT_VEHICLE_ID` in der Portal-`.env`.

## Server bereitstellen

```bash
# Credentials-Datei (nur root), dann:
sudo bash portal/scripts/provision-partner-status-sftp.sh btswiss
```

API neu bauen/starten, damit der Worker `PartnerStatusInboundService` lädt.

## Antwort-Mail an Querformat (Vorlage)

```
Hallo Thomas

danke für die Rückmeldung – hier die Zugangsdaten für die Statusrückmeldung:

  Host:     wog.logistikberater.at
  Port:     22
  Protokoll: SFTP
  User:     btswiss
  Passwort: <aus credentials/btswiss.txt>
  Format:   FORTRAS STAT512 (System Alliance)

Bitte die Statusdateien direkt in den Home-Ordner nach Login ablegen.
Bei Fragen gerne melden.

Beste Grüsse
Marcel
```

## Hinweise

- Auftragsimport (BORD512) und Status (STAT512) sind getrennte Kanäle.
- Statuscode-Mapping ist erweiterbar; nach dem ersten Live-File Codes ggf. nachziehen.
- Sample: `portal/data/samples/fortras/stat512-sample.txt`
