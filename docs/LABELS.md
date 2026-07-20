# Portal-Transportetiketten (SSCC) – Ablöse shipping.NET

Das Portal erzeugt Colli mit **GS1 SSCC-18** und PDF-Transportetiketten selbst – ohne `shipping.NET generateLabel`.

## Modell

- `ShipmentCollo` – physisches Packstück (`itemNumber`, `sscc`, Inhalt, Gewicht, **L×B×H in cm**)
- Bei Auftragserfassung: Colli inkl. Abmessungen pro Packstück; werden beim Anlegen sofort mit SSCC erzeugt
- `SsccSequence` – laufende Seriennummer pro Organisation
- `DocumentType.LABEL` – erzeugte PDF-Etiketten

## SSCC

Format: Extension(1) + Company-Prefix + Serial + Check Digit = **18 Ziffern**

```env
SSCC_GS1_COMPANY_PREFIX=9120101
SSCC_EXTENSION_DIGIT=0
```

Beispiel: `09120101…` (wie bestehende WOG-SSCCs).

## API

```http
GET  /api/shipments/:id/colli
GET  /api/shipments/:id/labels
POST /api/shipments/:id/labels
```

`POST …/labels` (auch für Kunden) stellt Colli sicher, vergibt SSCCs und speichert:

- Einzel-PDFs je Collo (`Label-…pdf`)
- kombiniertes Druck-PDF aller Etiketten (`Etiketten-{tracking}.pdf`) als `printDocument`

UI: Button **Etiketten drucken** im Sendungsdetail (nach Übergabe). Download über `/api/documents/:id/download`.

## Soloplan

Beim Order-Export werden vorhandene Colli inkl. `ssccCurrents` in `consignmentItems` gemappt.
