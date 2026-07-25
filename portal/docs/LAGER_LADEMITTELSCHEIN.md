# Lager · Lademittelscheine

Digitale Ablösung des Papier-Lademittelscheins (Tablet 10″ im Lager).

## Menü
- **Lager** (nur `ORG_ADMIN` / `MANDANT_DISPATCHER`)
  - **Lademittelscheine**
- Partner: **Lademittelscheine** unter Partner-Bereich (nur eigene Scheine)

## Ablauf
1. Tour aus Soloplan wählen → Kopfdaten (Partner, LKW, Fahrer, Ort)
2. Mengen EUP / Rahmen / Deckel / Gitterbox (Übergabe & Übernahme)
3. Zwei Unterschriften (WOG + Partner/Fahrer)
4. PDF erzeugen, an Partner-E-Mail senden, JSON nach Soloplan-FTP legen
5. Browser-Druck über PDF (physischer Drucker folgt separat)

## SFTP / FTP
| Richtung | Pfad |
|----------|------|
| Eingang (Soloplan → Portal) | `data/sftp/inbound/soloplan/lademittel/` |
| Ausgang (Portal → Soloplan) | `data/sftp/outbound/soloplan/lademittel/` |
| Verarbeitet | `…/lademittel/processed/` |

Inbound-JSON Beispiel:
```json
{
  "tourNumber": "183434",
  "reference": "294280",
  "handover": { "eup": 7, "rahmen": 0, "deckel": 0, "gitterbox": 0 },
  "takeover": { "eup": 23, "rahmen": 0, "deckel": 0, "gitterbox": 0 }
}
```

## API
- `GET /lager/lademittelscheine`
- `POST /lager/lademittelscheine/from-tour` `{ tourId }`
- `POST /lager/lademittelscheine/:id/complete` (Mengen + Signatur-DataURLs)
- `GET /lager/lademittelscheine/:id/pdf`
- `GET /lager/lademittelscheine/partner` (Partner-Rolle)
