# ebele – VIP-Datenaustausch (SFTP In + Out)

Partner **ebele** erhält Sendungsdaten als VIP-eLogistics-Datei (BDK) und liefert
Status sowie PODs zurück. Quelle der ausgehenden Daten: Soloplan-**Telematik-Touren**
für Fahrzeug **`erbelre`**.

## Wichtig

- **Keine Preise** in der Outbound-Datei (VBET / NNBET / WARENWERT bleiben leer).
- Schnittstelle: `portal/docs/partners/ebele/Schnittstellenbeschreibung_VIP_41f0.pdf`
- Status-Codes: `portal/data/samples/ebele/status-sample.txt` (gpANLAGE)

## SFTP

| | |
|--|--|
| Protokoll | **SFTP** (SSH) |
| Host | `wog.logistikberater.at` |
| Port | `22` |
| Benutzer | `ebele` |
| Passwort | Server `portal/data/sftp/credentials/ebele.txt` (**nicht in Git**) |
| Nach Login | `/outbound/` (Download), `/inbound/` (Upload) |

### Provisioning (VPS)

```bash
sudo bash portal/scripts/provision-ebele-sftp.sh ebele /opt/wog-portal/portal
```

Chroot: `data/sftp/partners/ebele/`

## Outbound (WOG → ebele)

1. Soloplan legt StdTelematics-Tour für Fahrzeug **erbelre** ab.
2. Portal importiert die Tour (bestehender Tour-Worker).
3. `EbeleVipService.processOutbound()` baut VIP **K**- und **L**-Sätze und schreibt
   `VIP_ebele_<stempel>.txt` nach `partners/ebele/outbound/`.
4. ebele holt die Datei per SFTP ab.

### Mapping (Auszug)

| VIP | Quelle |
|-----|--------|
| ANR | `EBELE_VIP_ANR` (Default `890037`) |
| AUFTNR | Soloplan `TransportOrder.Number` |
| LSR | ExternalConsignmentNumber / OrderNumber.Index |
| Absender/Empfänger | Tour-Consignment Details |
| GUTANZ / GUTEH / GUTKG | Freight / Items / Lademittel |

## Inbound (ebele → WOG)

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
| `EBELE_VIP_ENABLED` | `1` | Ein/Aus |
| `EBELE_VIP_ANR` | `890037` | Auftraggebernummer VIP |
| `EBELE_VEHICLE_MATCH` | `erbelre` | Fahrzeug Matchcode/ID/Kennzeichen |
| `EBELE_SFTP_USERNAME` | `ebele` | SFTP-/Ordnername |
| `EBELE_DEFAULT_VEHICLE_ID` | – | Fallback Soloplan-VehicleId für Status |
| `EBELE_OUTBOUND_DIR` / `EBELE_INBOUND_DIR` | partners/ebele/… | Override-Pfade |

## Worker

Der Integration-Worker ruft in jedem Tick `ebeleVip.processOutbound()` und
`ebeleVip.processInbound()` auf.
