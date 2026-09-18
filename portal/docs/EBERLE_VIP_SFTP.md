# Eberle – VIP-Datenaustausch (SFTP In + Out)

Partner **Eberle** erhält Sendungsdaten als VIP-eLogistics-Datei (BDK) und liefert
Status sowie PODs zurück. Quelle der ausgehenden Daten: Soloplan-**Telematik-Touren**
für Fahrzeug **`erbelre`** (Match auch `eberle`).

## Wichtig

- **Keine Preise** in der Outbound-Datei (VBET / NNBET / WARENWERT bleiben leer).
- Schnittstelle: `portal/docs/partners/eberle/Schnittstellenbeschreibung_VIP_41f0.pdf`
- Status-Codes: `portal/data/samples/eberle/status-sample.txt` (gpANLAGE)

## SFTP

| | |
|--|--|
| Protokoll | **SFTP** (SSH) |
| Host | `wog.logistikberater.at` |
| Port | `22` |
| Benutzer | `eberle` |
| Passwort | Server `portal/data/sftp/credentials/eberle.txt` (**nicht in Git**) |
| Nach Login | `/outbound/` (Download), `/inbound/` (Upload) |
| State (intern) | `data/sftp/state/eberle/` (nicht im Chroot) |

### Provisioning (VPS)

```bash
sudo bash portal/scripts/provision-eberle-sftp.sh eberle /opt/wog-portal/portal
```

Chroot: `data/sftp/partners/eberle/`

## Outbound (WOG → Eberle)

1. Soloplan legt StdTelematics-Tour für Fahrzeug **erbelre** ab.
2. Portal importiert die Tour (bestehender Tour-Worker).
3. `EberleVipService.processOutbound()` baut VIP **K**- und **L**-Sätze und schreibt
   `VIP_eberle_<stempel>.txt` nach `partners/eberle/outbound/`.
4. Eberle holt die Datei per SFTP ab.

### Mapping (Auszug)

| VIP | Quelle |
|-----|--------|
| ANR | `EBERLE_VIP_ANR` (Default `890037`) |
| AUFTNR | Soloplan `TransportOrder.Number` |
| LSR | ExternalConsignmentNumber / OrderNumber.Index |
| Absender/Empfänger | Tour-Consignment Details |
| GUTANZ / GUTEH / GUTKG | Freight / Items / Lademittel |

## Inbound (Eberle → WOG)

### Status (Text)

```
890037;B001-G0030;2026.03.11;0832;1772680;SPL19973;LS-500296-007;;0;;
890037;B001-G0031;2026.03.12;0958;1772680;SPL19973;LS-500296-007;;0;;
```

| Code | Bedeutung | Soloplan-Status |
|------|-----------|-----------------|
| B001-G0030 | Sendung abgeholt | LoadingFinished |
| B001-G0031 | Sendung ausgeliefert | UnloadingFinished |

Match über Ref1 / Ref2 / LSR → TourConsignment / Shipment → StdTelematics TransportOrderStatus.

### POD

PDF/JPG/PNG/TIFF nach `/inbound/` legen (Dateiname möglichst mit Auftragsnummer).
Wird als StdTelematics **Document** an Soloplan gesendet.

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|----------|---------|-------------|
| `EBERLE_VIP_ENABLED` | `1` | Ein/Aus |
| `EBERLE_VIP_ANR` | `890037` | Auftraggebernummer VIP |
| `EBERLE_VEHICLE_MATCH` | `erbelre,eberle` | Fahrzeug Matchcode/ID/Kennzeichen (kommagetrennt) |
| `EBERLE_SFTP_USERNAME` | `eberle` | SFTP-/Ordnername |
| `EBERLE_DEFAULT_VEHICLE_ID` | – | Fallback Soloplan-VehicleId für Status |
| `EBERLE_OUTBOUND_DIR` / `EBERLE_INBOUND_DIR` | partners/eberle/… | Override-Pfade |

## Worker

Der Integration-Worker ruft in jedem Tick `eberleVip.processOutbound()` und
`eberleVip.processInbound()` auf.
