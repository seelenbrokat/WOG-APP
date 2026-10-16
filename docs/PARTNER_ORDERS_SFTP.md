# Kunden-/Partner-SFTP: Auftragsimport (FORTRAS → Soloplan)

Kunden und Partner können Auftragsdateien **per SFTP** liefern, ohne Sendungen manuell im Portal zu erfassen. Die Freischaltung erfolgt **nur durch ORG_ADMIN je Kunde/Partner** – nicht pauschal.

## Quehenberger (Beispiel)

| | |
|--|--|
| Format | System Alliance **FORTRAS BORD512** (Sendungsdaten) |
| SFTP-User | `quehenberger` (nach Freischaltung) |
| Drop-Pfad | `inbound/partner-orders/quehenberger/` |
| Ziel | Soloplan OrderImportPORTAL v6 → `outbound/soloplan/orders/` |

Sample-Datei und Specs liegen unter den Uploads / Specs BORD512, STAT512, ENTL512.

> **Statusmeldungen (BT Swiss u. a.):** eigener Kanal `inbound/partner-status/{user}/`
> mit FORTRAS **STAT512** → siehe [BT_SWISS_STATUS_SFTP.md](../portal/docs/BT_SWISS_STATUS_SFTP.md).

## Admin-Freischaltung

1. Portal → **Kundenverwaltung** → Kunde wählen  
2. **SFTP-Inbound freischalten** → Benutzername (z. B. `quehenberger`) → Format `BORD512` → Speichern  
3. Einmaliges Passwort notieren  
4. Auf dem Server OS-User anlegen:

```bash
sudo bash portal/scripts/provision-partner-sftp.sh quehenberger
```

Credentials: `portal/data/sftp/credentials/{username}.txt`

## Transformation

BORD512 (Bordero mit mehreren Sendungen) wird zu **einem Soloplan-Auftrag je Sendung**
(eigene JSON-Datei pro Sendung):

- `order.externalNumber` = Sendungs-Nr. Versandpartner (G00), z. B. `A-21438081-A-1`
- je Order genau eine `consignment`
- Absender/Empfänger aus B00/SHP und B00/CON
- Packstücke, Gewicht, SSCC/NVE aus D00/F00/G00
- Frachtzahler = freigeschalteter Kunde (Soloplan-BP)

Test lokal:

```bash
npx ts-node --transpile-only portal/scripts/transform-bord512.ts \
  /path/to/s_wog….txt \
  portal/data/samples/fortras/orders-A-5025462
```

Beispiel-Output: `portal/data/samples/fortras/orders-A-5025462/order-A-21438081-A-1.json` usw.

API (Admin/Disposition):

```http
POST /api/integrations/partner-orders/transform
Content-Type: multipart/form-data
file=…&customerId=…&writeOutbound=true
```

## Worker

Der Integration-Worker pollt freigeschaltete Drop-Ordner und schreibt Soloplan-JSON ins Pickup-Verzeichnis (wie Portal-Sendungsexporte).
