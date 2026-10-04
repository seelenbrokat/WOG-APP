# WOG Portal – Handbuch aller Bereiche

Stand: **2026-10-03**  
Ziel: Ein Portal mit **allen** Funktionen. Erweiterungen kommen als **Patch/Update** auf die Produktions-Baseline – nicht als dauerhafte Container-Patches oder Branchen-Stacks.

Verwandte Docs:

- [PROD_BASELINE.md](./PROD_BASELINE.md) – Git-Baseline, Deploy, Sicherung
- [ARCHITECTURE.md](./ARCHITECTURE.md) – Komponenten & Rollen
- [DEPLOYMENT.md](./DEPLOYMENT.md) – Server-Deploy
- [PORTAL_TODO.md](../portal/docs/PORTAL_TODO.md) – offene Gaps

---

## 1. Überblick

| Schicht | Technologie | Aufgabe |
|---------|-------------|---------|
| Web | Next.js (`portal/apps/web`) | UI für Admin, Dispo, Kunde, Partner |
| API | NestJS (`portal/apps/api`) | REST, Auth, Business-Logik |
| Worker | Nest/Node (`worker.ts`) | SFTP-Imports, eZoll/Mercurio, Status, Archive |
| DB | PostgreSQL + Prisma | Persistenz |
| Dateien | `portal/data/` | Uploads, SFTP inbound/outbound, Integrationen |

**Mandanten:** WOG AG (`AG`), WOG GmbH (`GMBH`) unter Organisation WOG Logistics.  
**Rollen:** `ORG_ADMIN`, `MANDANT_DISPATCHER`, `CUSTOMER_USER`, `PARTNER`.

---

## 2. Bereiche (UI → Funktion)

### 2.1 Übersicht (`/dashboard`)

Einstieg nach Login. Kurzer Status je Rolle (Admin/Dispo/Kunde/Partner).

### 2.2 Sendungen (`/shipments`, `/shipments/new`, `/shipments/[id]`)

- Auftragserfassung (Absender/Empfänger, Colli, Termine, Dokumente)
- Labels / SSCC, Ladeliste, Status
- Export nach Soloplan als **OrderImportPORTAL** (ohne Zoll-Listenflags)
- Details: Dokumente, POD, Zoll-Referenzen (MRN/LRN)

→ [LABELS.md](./LABELS.md), [ORDERS_LOADING_LIST.md](./ORDERS_LOADING_LIST.md), [SOLOPLAN_ORDERS.md](./SOLOPLAN_ORDERS.md)

### 2.3 Track & Trace (`/track`)

Öffentlich: Trackingnummer + PIN. Keine Kunden-Livekarte (Roadmap).

### 2.4 Disposition

| Route | Zweck |
|-------|--------|
| `/tours/dashboard` | Dispo-Dashboard / Abweichungen |
| `/tours` | Touren & Fahrzeuge |
| `/tours/[id]` | Tour-Detail |
| `/tours/map` | Kartenmonitor / Flotte |
| `/tours/lademittel` | Lademittel Dispo |

Quellen: Soloplan/Tour-Import, Telematik, mTrack (wenn aktiv).

### 2.5 Partner

| Route | Zweck |
|-------|--------|
| `/partner/tours` | Zugewiesene Touren (lesen) |
| `/partner/lademittelscheine` | Partner-Lademittel |

Partner-Status schreiben: Roadmap. SFTP-Partneraufträge: [PARTNER_ORDERS_SFTP.md](./PARTNER_ORDERS_SFTP.md).

### 2.6 Fahrer / Zustell-App (`/fahrer`)

QR-Login, Ablieferbeleg (POD), Fotos, Lademittel, Telematik-Outbound.  
API: [FAHRER_APP_API.md](../portal/docs/FAHRER_APP_API.md), [VLB_ZUSTELLAPP_TELEMATICS.md](./VLB_ZUSTELLAPP_TELEMATICS.md).

### 2.7 Lager (`/lager`, `/lager/lademittelscheine`, `/lager/login-qr`)

Lademittelscheine, QR-Login Lager.  
→ [LAGER_LADEMITTELSCHEIN.md](../portal/docs/LAGER_LADEMITTELSCHEIN.md)

### 2.8 Scanning / Wareneingang

| Route | Zweck |
|-------|--------|
| `/scanning` | Wareneingang / Kontrolle |
| `/scanning/we-tc57` | WE TC57 |
| `/scanning/entladeberichte` | Entladeberichte (ETB) |

Worker: Wareneingang-XML, Proforma-WE, Schmidts-Ladeliste wo konfiguriert.

### 2.9 Verzollungsauftrag (`/customs`)

Portal-Formular für Verzollung. Schreibt Auftrag nach Soloplan mit:

- `verzollungsauftrag: true` (FileAPI named Flag → Soloplan CFBOOLEAN8; **kein** `order.customFields` – OrderImportPORTAL-Schema verbietet das)

**Sammelfahrzeug:** Checkbox „Sammelfahrzeug“. Erfassung geht sofort nach Soloplan; Kennzeichen/Grenze erst unter **Beladung Sammelfahrzeug** (`/customs/beladung`) per Auswahl → Soloplan-Update + Ladeliste + Ankunftsaviso an `zoll@worldofgreen.at`.

**Keine** AT/CH Ausfuhr-/Einfuhr-Listenflags hier – die kommen nur mit Docs/XMLs über OrderEzoll (siehe §3).

### 2.10 EZOLL-Hub (`/integrations`)

Interne Drehscheibe Soloplan ↔ LDV ↔ Mercurio.  
→ [EZOLL_HUB.md](./EZOLL_HUB.md)

### 2.11 Stammdaten & Verwaltung

| Route | Zweck | Rollen |
|-------|--------|--------|
| `/addresses` | Adressbuch | Admin, Dispo, Kunde |
| `/customers` | Kunden, SFTP-Inbound, Docs, Neutral-POD | Admin, Dispo |
| `/mandanten` | Mandanten | Admin, Dispo |
| `/partners` | Partner | Admin, Dispo |
| `/users` | Benutzer | Admin |
| `/audit` | Änderungsprotokoll | Admin |
| `/settings` | Einstellungen / Prefs | alle |
| `/change-password` | Passwort | alle |

---

## 3. Zoll & Soloplan-Flags (kritisch)

### 3.1 Zwei Kanäle – strikt trennen

| Kanal | Datei-API / Pfad | Was wird gesetzt |
|-------|------------------|------------------|
| **OrderImportPORTAL** | `outbound/soloplan/orders/` | Neuer Auftrag inkl. optional `verzollungsauftrag` (→ CFBOOLEAN8; ohne `order.customFields`) |
| **OrderEzoll** | `outbound/soloplan/ezoll/consignment/` (bzw. tour/) | Updates mit Docs/XMLs + **Listenflags** AT/CH |

Regel: **Zoll-Listenflags nur mit Dokumenten/XMLs über OrderEzoll**, nie über Portal-Erfassung / OrderImport.

### 3.2 Mapping (Sendung vs. Auftrag)

| Liste / Checkbox | Soloplan-Feld | Ebene | Trigger (OrderEzoll) |
|------------------|---------------|-------|----------------------|
| AT Ausfuhr | `ausfuhrverzollungATEU` (+ `cC529C`) | Sendung | CC529 / ABD |
| AT Einfuhr | `aTEinfuhr` + `customBool8` | Sendung | EZ922 / EZ923 |
| CH Einfuhr | `bezugsschein` / `einfuhrliste` + `customBool6` | Sendung | Mercurio BS/EL / Einfuhr-PDF |
| CH Ausfuhr | `customBool7` | Sendung | Mercurio AUSFUHR_VV / Ausfuhr |
| Verzollungsauftrag | `verzollungsauftrag` (named Flag) | **Auftrag** | Portal Customs / OrderImport |

Hinweis: Sendungs-`customBool8` (AT Einfuhr via OrderEzoll) ≠ Auftrags-Flag `verzollungsauftrag` (OrderImport). `order.customFields` ist im OrderImportPORTAL-Schema nicht erlaubt.

Code:

- `portal/apps/api/src/customs/ezoll-soloplan.service.ts`
- `portal/apps/api/src/integrations/soloplan-order.mapper.ts`

### 3.3 Inbound Zoll

| Quelle | Inhalt | Folge |
|--------|--------|--------|
| eZoll SFTP/Mail | CC529, EZ92x, CC029, … | Match Auftrag/Sendung → OrderEzoll + PDF an Soloplan |
| Mercurio | Bezugsschein, Einfuhrliste, eVV, Bordereau, Ausfuhr | Flags + Docs |
| SmartBorder | Ingest-Key | Adressbuch / File-API wo aktiv |

Details: [EZOLL_HUB.md](./EZOLL_HUB.md), [SOLOPLAN.md](./SOLOPLAN.md).

---

## 4. Partner-Integrationen (Worker)

| Partner / Kanal | Doc | Kurz |
|-----------------|-----|------|
| Quehenberger | POD-Mail, BORD512, List-Tracking | Status/POD per Mail/SFTP |
| BT Swiss | [BT_SWISS_STATUS_SFTP.md](../portal/docs/BT_SWISS_STATUS_SFTP.md) | FORTRAS Status |
| Eberle VIP | [EBERLE_VIP_SFTP.md](../portal/docs/EBERLE_VIP_SFTP.md) | VIP Status SFTP |
| Post | [POST_ABLIEFERBELEG_API.md](../portal/docs/POST_ABLIEFERBELEG_API.md) | Ablieferbeleg-API |
| shipping.NET | [SHIPPINGNET_STATUS.md](./SHIPPINGNET_STATUS.md) | Status-API |
| Soloplan BP | [SOLOPLAN_BUSINESS_PARTNERS.md](./SOLOPLAN_BUSINESS_PARTNERS.md) | Masterdata |

Worker-Isolation: Fehler in einem Import dürfen andere Jobs nicht abbrechen ([PORTAL_TODO.md](../portal/docs/PORTAL_TODO.md) A4).

---

## 5. Betrieb kurz

1. **Sicherung vor jedem Deploy** – lokal `_backup/` bzw. VPS `backup-portal.sh`  
2. **Nur aus Git deployen** – Image bauen, kein `sed`/Patch im laufenden Container  
3. **Smoke nach Deploy** – API health, OrderImport-Pickup, OrderEzoll-Pickup, eine Testsendung  
4. **Patches** – kleiner PR auf die Portal-Baseline, mergen, dann Deploy  

Ausführlich: [PROD_BASELINE.md](./PROD_BASELINE.md).

---

## 6. Checkliste „alles funktioniert“

| # | Prüfen | OK? |
|---|--------|-----|
| 1 | Web erreichbar, Login Admin/Dispo/Kunde | |
| 2 | Neuer Auftrag → JSON in `soloplan/orders/` | |
| 3 | Customs-Formular → `verzollungsauftrag` (OrderImport named Flag) | |
| 4 | eZoll/Mercurio Inbound → PDF + OrderEzoll mit korrektem Flag | |
| 5 | Fahrer-QR / Ablieferbeleg | |
| 6 | Touren/Map ohne 500 | |
| 7 | Partner-SFTP (Quehenberger/BT/Eberle) laut Env | |
| 8 | Backup-Cron schreibt Dump | |
| 9 | Nach Deploy: Image-Commit = Git-Commit (keine Live-Patches) | |

---

## 7. Bekannte Grenzen (kein Defekt der Baseline)

- In-App-Benachrichtigungen, Dokumentencenter, Kunden-Reporting: Roadmap  
- Hub LDV/Mercurio-Native-Adapter teils Stub  
- `origin/main` enthält derzeit nur Android – **Portal-Baseline ist ein eigener Branch** (siehe PROD_BASELINE)
