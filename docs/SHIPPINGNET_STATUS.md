# shipping.NET – Status „Zugestellt“ setzen

Über das WOG-Portal kann mit einer **Sendungsnummer** in OnDot/shipping.NET der Status **DVD (Zugestellt)** gesetzt werden.

## Portal-Endpunkt (empfohlen)

```http
POST /api/integrations/shippingnet/shipments/{sendungsnummer}/delivered
Authorization: Bearer <JWT>
Content-Type: application/json
```

### Berechtigung

- `ORG_ADMIN`
- `MANDANT_DISPATCHER`

### Beispiel

```bash
# 1) Login
TOKEN=$(curl -sS -X POST https://wog.logistikberater.at/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"***"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

# 2) Status Zugestellt setzen
curl -sS -X POST \
  "https://wog.logistikberater.at/api/integrations/shippingnet/shipments/435958.1/delivered" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"description":"Zugestellt"}'
```

### Optionaler Body

```json
{
  "description": "Zugestellt",
  "statusDate": "2026-07-19T19:10:00.000Z"
}
```

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| `description` | nein | Freitext (Default: `Zugestellt`) |
| `statusDate` | nein | ISO-8601 Zeitstempel (Default: jetzt) |

### Erfolgreiche Antwort

```json
{
  "ok": true,
  "shipmentNumber": "435958.1",
  "statusId": "DVD",
  "description": "Zugestellt",
  "statusDate": "2026-07-19T19:10:00.000Z",
  "shippingNet": {}
}
```

### Status prüfen

```http
GET /api/integrations/shippingnet/shipments/{sendungsnummer}/status
Authorization: Bearer <JWT>
```

### Beliebigen Status setzen

```http
POST /api/integrations/shippingnet/shipments/{sendungsnummer}/status
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "statusId": "DVD",
  "description": "Zugestellt"
}
```

Wichtige Statuscodes (shipping.NET):

| Code | Bedeutung | Final |
|------|-----------|-------|
| `DVD` | Zugestellt | ja |
| `CMP` | Abgeschlossen | ja |
| `RUN` | Unterwegs | nein |
| `SAT` | Zu Transport hinzugefügt | nein |
| `IMP` | Importiert | nein |

Vollständige Liste: [Sendungsstati](https://docs.ondot.at/de/uc/shipping/shipping-shipment-stati.html)

---

## Ablieferbeleg hochladen

```http
POST /api/integrations/shippingnet/shipments/{sendungsnummer}/ablieferbeleg
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

| Feld | Pflicht | Beschreibung |
|------|---------|--------------|
| `file` | ja | PDF, PNG oder JPG (max. 20 MB) |
| `documentType` | nein | shipping.NET-Typ (Default: `SHIPPINGNET_POD_DOCUMENT_TYPE` bzw. `OtherDocument`) |
| `comment` | nein | Default: `Ablieferbeleg` |
| `number` | nein | Dokumentnummer (Default: `POD`) |
| `markDelivered` | nein | `true` = zusätzlich Status DVD setzen |
| `statusDate` | nein | nur mit `markDelivered` |

### Beispiel

```bash
curl -sS -X POST \
  "https://wog.logistikberater.at/api/integrations/shippingnet/shipments/435958.1/ablieferbeleg" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./ablieferbeleg.pdf;type=application/pdf" \
  -F "comment=Ablieferbeleg" \
  -F "markDelivered=true"
```

### Generischer Dokument-Upload

```http
POST /api/integrations/shippingnet/shipments/{sendungsnummer}/document
```

Gleiche Auth/Multipart-Felder; `documentType` ist hier **pflicht**.

### Voraussetzung in OnDot

shipping.NET akzeptiert den Upload nur, wenn der **Dokumenttyp in der Systemkonfiguration aktiviert** ist. Sonst:

```text
shipmentDocumentGetList: "Other Document" is not enabled
```

Vorgehen:

1. In shipping.NET → **Systemkonfiguration** → Dokumenttypen / Geschäftsdokumente den gewünschten Typ aktivieren (z. B. **Other Document** oder **Delivery Note**).
2. Im Portal `.env` setzen:

```env
SHIPPINGNET_POD_DOCUMENT_TYPE=OtherDocument
```

(oder `DeliveryNote`, je nachdem was aktiviert wurde)

3. API-Container neu starten, damit die Env greift.

Intern ruft das Portal auf:

```http
POST {SHIPPINGNET_PUBLIC_API_BASE}/Shipment/addDocument
```

```json
{
  "ShipmentMatching": { "Number": "435958.1" },
  "Document": {
    "Type": "OtherDocument",
    "Comment": "Ablieferbeleg",
    "Number": "POD",
    "File": { "ContentBase64": "…", "FileType": "PDF" }
  }
}
```

---

## Was der Portal-Endpunkt intern macht

1. Liest Credentials aus der Portal-`.env` (`SHIPPINGNET_*`)
2. Ruft shipping.NET Public API auf:

```http
POST {SHIPPINGNET_PUBLIC_API_BASE}/Shipment/importStatus
client-id: …
orgunit-id: …
auth-token: …
Content-Type: application/json
```

```json
{
  "ShipmentMatching": { "Number": "435958.1" },
  "StatusData": {
    "StatusID": "DVD",
    "Description": "Zugestellt",
    "StatusDate": "2026-07-19T19:10:00.000Z"
  }
}
```

3. Schreibt einen Audit-Log-Eintrag `shippingnet.status.import`

---

## Direkt über shipping.NET (ohne Portal)

Falls ohne Portal gearbeitet wird:

```bash
curl -sS -X POST \
  "https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Shipment/importStatus" \
  -H "Content-Type: application/json" \
  -H "client-id: $SHIPPINGNET_CLIENT_ID" \
  -H "orgunit-id: $SHIPPINGNET_ORG_UNIT_ID" \
  -H "auth-token: $SHIPPINGNET_ORG_UNIT_GUID" \
  -d '{
    "ShipmentMatching": { "Number": "435958.1" },
    "StatusData": { "StatusID": "DVD", "Description": "Zugestellt" }
  }'
```

Credentials stammen aus shipping.NET → System Configuration → API (`ApiData`).

---

## Konfiguration Portal

In `portal/.env`:

```env
SHIPPINGNET_ENABLED=true
SHIPPINGNET_MODE=rest
SHIPPINGNET_BASE_URL=https://shippingnet03.ondot.at/WOG
SHIPPINGNET_PUBLIC_API_BASE=https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1
SHIPPINGNET_CLIENT_ID=…
SHIPPINGNET_ORG_UNIT_ID=…
SHIPPINGNET_ORG_UNIT_GUID=…
SHIPPINGNET_API_KEY=ClientID:OrgUnitID:OrgUnitGUID
SHIPPINGNET_POD_DOCUMENT_TYPE=OtherDocument
```

Konfiguration prüfen:

```http
GET /api/integrations/shippingnet/status
```

---

## OpenAPI-Referenz

Lokal im Repo:

- `docs/shippingnet/wog-apidata/openapi/Shipment.openapi.json`
- `docs/shippingnet/wog-apidata/API_SPEC.md`
- `docs/shippingnet/wog-apidata/README.md`
