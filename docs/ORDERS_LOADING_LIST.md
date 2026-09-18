# Aufträge, Übergabe & Ladeliste

## Übergabe erkennen

Nach dem Absenden einer Sendung gilt:

- Status **Übermittelt** (`SUBMITTED`)
- Auftragsnummer **VLB…** am `TransportOrder`
- Banner im Sendungsdetail mit Tracking/PIN

Optional zusätzlich: TMS-Hinweis (`soloplanRef` am Auftrag), wenn der Soloplan-Export gelaufen ist.

## 1:n Sendungen

Mehrere Sendungen können denselben Auftrag teilen (`Shipment.orderId`).

- Neuer Auftrag: Standard bei „Auftrag übermitteln“
- Weitere Sendung: `orderId` setzen oder UI „Weitere Sendung zum Auftrag“

## Ladeliste / Auftragsbestätigung

```http
POST /api/orders/:orderId/loading-list
```

Erzeugt ein PDF mit allen Sendungen und Colli (kumuliert), speichert `DocumentType.LOADING_LIST`.

Weitere Endpunkte:

```http
GET /api/orders?openOnly=1
GET /api/orders/:id
```
