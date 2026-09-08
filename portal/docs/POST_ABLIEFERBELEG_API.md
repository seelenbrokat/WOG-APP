# Swiss Post → WOG Portal: Ablieferbeleg-API

Schnittstelle, damit die **Schweizerische Post** (oder ein angebundener Dienst) digitale Ablieferbelege an das **WOG Portal** liefert. Der Beleg erscheint dann an der Sendung und ist für den Frachtzahler (z. B. Quehenberger) im Kundenportal sichtbar – sofern das Dokumentenmodul / Kategorie **POD** freigeschaltet ist.

**Base-URL (Produktion):** `https://wog.logistikberater.at/api`  
**Auth:** HTTP-Header `X-API-KEY: <von WOG bereitgestellter Schlüssel>`

---

## Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|----------------|
| `GET` | `/integrations/post/health` | Health / Konfigurationsstatus |
| `POST` | `/integrations/post/ablieferbelege` | Upload per **multipart/form-data** |
| `POST` | `/integrations/post/ablieferbelege/json` | Upload per **JSON + Base64** |
| `POST` | `/integrations/post/tracking` | Früh: nur **Post-Barcode** setzen (bei Übergabe, ohne POD) |

---

## 1) Multipart-Upload (empfohlen)

`POST /api/integrations/post/ablieferbelege`

**Content-Type:** `multipart/form-data`

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| `file` | **ja** | PDF, JPG oder PNG (max. 20 MB) |
| `shipmentNumber` | * | Soloplan Auftrag.Sendung, z. B. `435958.1` |
| `orderNumber` | * | Nur Auftragsnummer, z. B. `435958` |
| `itemNumber` | nein | Sendungsposition, z. B. `1` (mit `orderNumber`) |
| `trackingNumber` | * | Portal-Tracking, z. B. `WOG2608…` |
| `postBarcode` | * | Swiss-Post-Barcode / Paketnummer |
| `clientReference` | * | Freie Referenz |
| `deliveredAt` | nein | Zustellzeit ISO-8601, z. B. `2026-09-04T14:30:00+02:00` |
| `markDelivered` | nein | Default `true` – setzt Portal-Status auf zugestellt |

\* Mindestens **eines** der Referenzfelder muss gesetzt sein (`shipmentNumber` **oder** `trackingNumber` **oder** `postBarcode` **oder** `orderNumber`[+`itemNumber`] **oder** `clientReference`).

### Beispiel curl

```bash
curl -sS -X POST 'https://wog.logistikberater.at/api/integrations/post/ablieferbelege' \
  -H 'X-API-KEY: ***' \
  -F 'file=@/pfad/ablieferbeleg.pdf;type=application/pdf' \
  -F 'shipmentNumber=435958.1' \
  -F 'postBarcode=99.00.123456.12345678' \
  -F 'deliveredAt=2026-09-04T14:30:00+02:00' \
  -F 'markDelivered=true'
```

### Erfolgsantwort `200`

```json
{
  "ok": true,
  "documentId": "clx…",
  "shipmentId": "clx…",
  "trackingNumber": "WOG2608ABCDEF",
  "soloplanRef": "435958.1",
  "customerId": "clx…",
  "fileName": "Post-Ablieferbeleg 435958.1.pdf",
  "delivered": true,
  "duplicated": false
}
```

`duplicated: true` = derselbe Beleg (gleicher Quelldateiname) war bereits vorhanden – kein Doppel-Upload.

---

## 2) JSON + Base64

`POST /api/integrations/post/ablieferbelege/json`  
**Content-Type:** `application/json`

```json
{
  "shipmentNumber": "435958.1",
  "postBarcode": "99.00.123456.12345678",
  "deliveredAt": "2026-09-04T14:30:00+02:00",
  "markDelivered": true,
  "fileName": "ablieferbeleg.pdf",
  "mimeType": "application/pdf",
  "contentBase64": "<Base64 ohne oder mit data:application/pdf;base64,-Prefix>"
}
```

---

## 3) Früh: Post-Tracking bei Übergabe

`POST /api/integrations/post/tracking`  
**Content-Type:** `application/json`

Sobald die Sendung an die Post übergeben wurde (Label/Barcode bekannt), **ohne** auf den POD zu warten:

```json
{
  "shipmentNumber": "435958.1",
  "postBarcode": "99.00.123456.12345678"
}
```

Der Barcode erscheint dann in der Portal-Sendungsliste (Feld „Post …“) und ist suchbar. Tracking auf **post.ch** erfolgt mit diesem **Post-Barcode**, nicht mit der WOG-Trackingnummer.

---

## Matching-Regeln (Portal-Sendung)

1. `shipmentNumber` im Format `Auftrag.Position` → `soloplanRef`
2. sonst `trackingNumber`
3. sonst `orderNumber` (+ optional `itemNumber`)
4. sonst `postBarcode` / `clientReference` gegen Referenzfelder

Wird keine Sendung gefunden → **HTTP 404**.

---

## HTTP-Statuscodes

| Code | Bedeutung |
|------|-----------|
| 200 | Beleg gespeichert (oder bereits vorhanden) |
| 400 | Pflicht fehlt / ungültiges Format |
| 401 | API-Key fehlt oder ungültig |
| 404 | Keine passende Portal-Sendung |
| 503 | API-Key serverseitig nicht konfiguriert |

---

## Alternative: SFTP-Drop

Ordner auf dem WOG-SFTP:

`inbound/post-ablieferbelege/`

Dateiname-Beispiele:

- `435958.1__99.00.123456.12345678.pdf`
- `435958.1__POD__beleg.pdf`
- `WOG2608ABCDEF__POD__beleg.pdf`

Der Worker verarbeitet die Dateien automatisch und verschiebt sie nach `processed/` bzw. `failed/unmatched/`.

---

## Sichtbarkeit für den Kunden (Frachtzahler)

- Dokumenttyp: **POD** / Kategorie **Abliefernachweis**
- Quelle: `POST`
- Voraussetzung im Portal: Kunde hat **Dokumente-Modul** aktiv und Kategorie **POD** freigeschaltet

---

## Kontakt / Schlüssel

API-Key und ggf. Testsystem werden von WOG Logistics bereitgestellt (`POST_ABLIEFERBELEG_API_KEY`).
