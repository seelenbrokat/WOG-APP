# portal@ → Wareneingangs-Scanning

Ungelesene Mails an **portal@worldofgreen.ch** mit PDF-Anhang werden vom Worker zu WE-Sessions für TC57:

| Anhang / Inhalt | Ziel |
|-----------------|------|
| Schmidts „Schweiz fertig“ / Ladeliste (LAK…) | `WE Schmidts · …` |
| Unitec Proforma / Ausfuhr (BK…) | Proforma-WE-Session + Entladeliste-Mail |

## Ablauf

1. Graph Client Credentials (`Mail.Read` / `Mail.ReadWrite`)
2. Inbox ungelesen + PDF
3. Klassifikation (Betreff/Dateiname oder PDF-Text)
4. Ablage unter `inbound/wareneingang/ladelisten` bzw. `rechnungen`
5. Bestehende Pipelines `SchmidtsLadelisteWeService` / `ProformaWeService`
6. Mail → gelesen + Ordner **WE-verarbeitet**

## Konfiguration (`.env` api/worker)

```
GRAPH_TENANT_ID=…
GRAPH_CLIENT_ID=…
GRAPH_CLIENT_SECRET=…
GRAPH_SCOPE=https://graph.microsoft.com/.default
GRAPH_MAILBOX=portal@worldofgreen.ch
GRAPH_WE_MAIL_ENABLED=1
```

Nur `portal@` – keine anderen Postfächer.

## Manuell

- `GET /api/goods-receipt/portal-mail/status`
- `POST /api/goods-receipt/portal-mail/process-inbox`
