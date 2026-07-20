# WOG Portal – MCP-Server

Der MCP-Server `@wog/mcp` macht **Statusabfrage** und **Auftragserfassung** für KI-Clients (Cursor, Claude Desktop, …) verfügbar.

## Tools

### Status
| Tool | Beschreibung |
|------|--------------|
| `wog_whoami` | Angemeldeter Benutzer |
| `wog_list_shipments` | Sendungen inkl. Status |
| `wog_get_shipment` | Sendungsdetail (Events, Colli, Extras, Avis-Tel) |
| `wog_track` | Öffentliches Tracking (TN + PIN) |
| `wog_update_shipment_status` | Status setzen (Dispo/Admin) |
| `wog_list_orders` / `wog_get_order` | VLB-Aufträge |
| `wog_status_labels` | Status → deutsche Labels |

### Auftragserfassung
| Tool | Beschreibung |
|------|--------------|
| `wog_list_mandanten` | Mandanten für `mandantId` |
| `wog_list_addresses` | Adressbuch |
| `wog_list_templates` | Vorlagen |
| `wog_list_packaging_types` | Verpackungscodes (EUP, …) |
| `wog_list_extra_options` | Zusatz-Checkboxen (Hebebühne, Aviso, …) |
| `wog_create_shipment` | Neue Sendung anlegen |

## Setup

```bash
cd portal
npm install
npm run build -w @wog/shared
npm run build -w @wog/mcp
```

### Umgebungsvariablen

| Variable | Pflicht | Bedeutung |
|----------|---------|-----------|
| `WOG_API_URL` | nein | Default `https://wog.logistikberater.at/api` |
| `WOG_EMAIL` | ja* | Portal-Login |
| `WOG_PASSWORD` | ja* | Portal-Passwort |
| `WOG_ACCESS_TOKEN` | ja* | Alternativ fertiges JWT |

\* Entweder Token **oder** E-Mail+Passwort.

### Cursor (`~/.cursor/mcp.json` oder Projekt `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "wog-portal": {
      "command": "node",
      "args": ["/ABS/PFAD/WOG-APP/portal/apps/mcp/dist/index.js"],
      "env": {
        "WOG_API_URL": "https://wog.logistikberater.at/api",
        "WOG_EMAIL": "kunde@example.com",
        "WOG_PASSWORD": "…",
        "WOG_ACCESS_TOKEN": ""
      }
    }
  }
}
```

Entwicklung mit `tsx` (ohne vorherigen Build):

```json
{
  "mcpServers": {
    "wog-portal": {
      "command": "npx",
      "args": ["tsx", "/ABS/PFAD/WOG-APP/portal/apps/mcp/src/index.ts"],
      "cwd": "/ABS/PFAD/WOG-APP/portal/apps/mcp",
      "env": {
        "WOG_API_URL": "https://wog.logistikberater.at/api",
        "WOG_EMAIL": "kunde@example.com",
        "WOG_PASSWORD": "…"
      }
    }
  }
}
```

### Inspector (manuell testen)

```bash
cd portal/apps/mcp
npm run inspect
```

## Beispiel: Auftrag per MCP

1. `wog_list_mandanten` → `mandantId`
2. optional `wog_list_addresses` / `wog_list_templates`
3. `wog_list_extra_options` bei Bedarf
4. `wog_create_shipment` mit Adressen, `positions`, `deliveryAvisPhone`, `extras`

## Sicherheit

- Credentials nur in lokaler MCP-Config / Secrets – **nicht** committen.
- Der Server spricht ausschließlich die bestehende Portal-API an (JWT).
- Status-Änderungen und fremde Kundendaten sind rollenabhängig wie im Web-Portal.
