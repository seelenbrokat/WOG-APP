# WOG Portal – Komplette Todo-Liste

Stand: **2026-09-19** (Analyse Branch-Tip `cursor/ebele-vip-sftp-7079` + Live-VPS).  
Quellen: Code (`apps/api`, `apps/web`), Prisma, Docs, Worker, `.env.example`, offene PRs.

**Legende Status:** `offen` · `teilweise` · `defekt` · `erledigt`  
**Priorität:** P0 kritisch · P1 hoch · P2 mittel · P3 niedrig

---

## A) Kritisch / sofort (Sicherheit & Datenverlust)

| ID | Todo | Status | Beleg / Hinweis |
|----|------|--------|-----------------|
| A1 | **Soloplan `order-link` absichern** (API-Key/HMAC/IP) – Endpoint ist `@Public()` und kann `soloplanRef`/Status setzen | defekt | `soloplan-order-link.controller.ts` |
| A2 | **Partner-/Eberle-Status: bei fehlender VehicleId nicht nach `processed` verschieben** (Retry/Quarantäne) | defekt | `eberle-vip.service.ts`, `partner-status-inbound.service.ts` |
| A3 | **SmartBorder-Ingest Key in Prod setzen** oder Flag/Key-Konsistenz in `.env.example` klären | defekt | `SMARTBORDER_INGEST_KEY` leer → Service disabled trotz ENABLED=true |
| A4 | **Worker-Tick isolieren** – Fehler in einem Import darf Rest (eZoll/Mercurio/POD) nicht abbrechen | defekt | `worker.ts` ein großer try/catch |

---

## B) Roadmap – noch nicht / teilweise umgesetzt

Aus `FEATURE_ROADMAP.md` (Stand 2026-07-24), neu bewertet:

| ID | Todo | Status | Prio |
|----|------|--------|------|
| B1 | **Dokumentencenter** – zentrale Suche über POD, Ladelisten, ETB, Rechnungen | offen | P1 |
| B2 | **In-App-Benachrichtigungen** (Glocke + Historie); Prefs bisher nur E-Mail | offen | P1 |
| B3 | **Kunden Live-Track mit Karte + ETA** (Karte heute nur Dispo `/tours/map`) | teilweise | P1 |
| B4 | **Avisierung ausführen** – `smsAviso`/`emailAviso` speichern, aber kein Versand an Empfänger | teilweise | P1 |
| B5 | **Kunden-Reporting** (Volumen, On-Time, Colli/kg, Excel/PDF) | offen | P2 |
| B6 | **Schaden-/Reklamationsmodul** (Kunde/Dispo; Fotos heute nur WE) | offen | P2 |
| B7 | **Rechnungseinsicht** als Modul (heute nur Doc-Kategorie INVOICE) | teilweise | P2 |
| B8 | **Partner Self-Service: Status setzen** (UI liest Touren, schreibt keinen Status) | teilweise | P2 |
| B9 | **Feinere Rollen** (Lesen vs. Erfassen) + Mandantenzugriff nachträglich in UI | teilweise | P2 |
| B10 | **Kunden-API-Keys + Webhooks** bei Statuswechsel (Partner-Keys existieren) | offen | P2 |
| B11 | **Tarif-/Kostenübersicht** | offen | P3 |
| B12 | Wiederkehrende Aufträge | erledigt | – |
| B13 | Abweichungs-Cockpit Dispo | erledigt | – |
| B14 | Audit-Protokoll | erledigt | – |
| B15 | Mobil-Optimierung Kunden (grundlegend responsive) | teilweise | P3 |

---

## C) Integrationen – Lücken & Stubs

| ID | Todo | Status | Prio |
|----|------|--------|------|
| C1 | **EZOLL-Hub Adapter** LDV/Mercurio/Soloplan-Customs aus Stub → produktiv (Mappings) | teilweise | P1 |
| C2 | **Auto-Transfer Hub** bei Verzollungsauftrag (optional laut Docs) | offen | P2 |
| C3 | **`SoloplanService.pullPods()`** implementieren oder Aufruf aus `syncPending` entfernen | offen | P2 |
| C4 | **Fahrer-Chat → Soloplan** klären (XSD ohne Message; Default Upload aus) + Dispo-UI | teilweise | P1 |
| C5 | **mTrack Live-GPS** in Prod aktivieren (`MTRACK_ENABLED`) oder UI-Hinweis | teilweise | P2 |
| C6 | **shipping.NET** verdrahten (Credentials) + optional Web-UI / POD-Anbindung | teilweise | P1 |
| C7 | **Post-Ablieferbeleg API-Key** in Prod setzen | teilweise | P2 |
| C8 | **Env-Tippfehler `TELEMATTICS_OUT_DIR`** → `TELEMATICS_OUT_DIR` (Alias behalten) | defekt | P2 |
| C9 | **Eberle**: `.env.example` um `EBERLE_*` ergänzen; Default-VehicleId für Status | teilweise | P1 |
| C10 | **Redis** nutzen oder aus Compose/Docs entfernen (aktuell ungenutzt) | offen | P3 |
| C11 | **Lademittelschein physischer Drucker** | offen | P3 |
| C12 | **Android-App** an Portal-API statt Mockdaten | offen | P2 |
| C13 | Soloplan-Modus Prod: Stub (`SOLOPLAN_ENABLED=false`) vermeiden | teilweise | P2 |

Bereits aktiv (kein Todo, nur Kontext): eZoll-Inbound, Mercurio PDF-Inbound, Quehenberger BORD512, BT Swiss Status, Eberle VIP, Tour/Telematics, Wareneingang/ETB, Lademittel.

---

## D) UI ↔ API Gaps

| ID | Todo | Status | Prio |
|----|------|--------|------|
| D1 | **Dispo-UI für Fahrer-Chat** (`/fahrer/chat` API ohne Portal-Seite) | offen | P2 |
| D2 | **E-Mail-Outbox Admin-UI** (`GET /notifications/outbox`) | offen | P3 |
| D3 | **User-Liste: Mandantenzugriff editieren** (API `PATCH …/mandant-access` vorhanden) | teilweise | P2 |
| D4 | **shipping.NET Admin-UI** (nur REST) | offen | P3 |
| D5 | **Doppelte `FahrerTelematicsService`** (`driver/` vs `fahrer/`) zusammenführen | defekt | P1 |

---

## E) Betrieb / Qualität / Prozess

| ID | Todo | Status | Prio |
|----|------|--------|------|
| E1 | **`.env.example` vervollständigen** (Eberle, Mercurio-Flags, Mail-Tos, CORS, Chat-Upload, …) | defekt | P1 |
| E2 | **FORTRAS Jest-Specs** in `npm test` aufnehmen (`stat512` / `bt-swiss-status`) | defekt | P2 |
| E3 | **`prisma generate` in Root-Setup/postinstall** (sonst hunderte TS-Fehler lokal) | defekt | P2 |
| E4 | Leere `/* ignore */`-Catches in kritischen Pfaden loggen (eZoll Follow-up, Proforma, …) | teilweise | P2 |
| E5 | Docs: BP-Import Passwort (`WillkommenWOG1!` vs. Einmal-Passwort) angleichen | defekt | P3 |
| E6 | **115 offene Draft-PRs** konsolidieren / mergen (Agent-Kette) | defekt | P1 |
| E7 | FEATURE_ROADMAP Datum/Status aktualisieren (dieser Datei folgen) | offen | P3 |

---

## F) Modul-Matrix (Ist-Zustand)

| Bereich | Web | API/Worker | Bemerkung |
|---------|-----|------------|-----------|
| Auth / Users / Mandanten | ✅ | ✅ | Feinrechte fehlen |
| Sendungen / Labels / Ladeliste | ✅ | ✅ | Aviso ohne Versand |
| Tracking (Code+PIN) | ✅ | ✅ | Keine Kundenkarte |
| Touren / Dispo / Map / Exceptions | ✅ | ✅ | Map nur Dispo |
| Scanning / WE / ETB | ✅ | ✅ | – |
| Customs / eZoll / Mercurio Inbound | ✅ | ✅ | Hub-Adapter Stub |
| Lager / Lademittelschein | ✅ | ✅ | Drucker offen |
| Fahrer-App / QR / Telematik | ✅ (App) | ✅ | Chat→Soloplan offen |
| Partner Touren / LMS | ✅ | ✅ | Kein Status-Schreiben |
| Kunden-Dokumente | ✅ | ✅ | Kein globales Doc-Center |
| Integrationen-Übersicht | ✅ | ✅ | shipping.NET ohne UI |
| Audit | ✅ | ✅ | – |
| Reporting / Tarife / Rechnungen | ❌ | ❌/teilw. | Roadmap |
| In-App Notifications | ❌ | ❌ | Nur E-Mail-Prefs |
| Kunden-API / Webhooks | ❌ | ❌ | – |

---

## G) Empfohlene Reihenfolge (Sprint-Schnitt)

### Sprint 1 – Stabilität & Security
1. A1 order-link Auth  
2. A2 Status-Retry statt „processed“  
3. A4 Worker-Isolation  
4. E1 Env-Example + C9 Eberle-Config  
5. D5 Telematik-Services mergen (Plan)

### Sprint 2 – Kundennutzen
6. B2 In-App Glocke  
7. B3 Kunden-Karte/ETA  
8. B4 Aviso-Versand  
9. B1 Dokumentencenter (MVP Suche)

### Sprint 3 – Integrationen
10. C6 shipping.NET Credentials + Smoke-Test  
11. C1 Hub-Mappings oder Stub-UI klar „nicht produktiv“  
12. C4 Chat-Strategie Soloplan/Dispo  
13. C3 pullPods entfernen oder bauen  

### Sprint 4 – Ausbau
14. B5 Reporting  
15. B6 Reklamationen  
16. B8 Partner Status  
17. B10 Kunden-API  

---

## H) Bewusst nicht als Defekt

- Soloplan File-API + Telematik Outbound (aktiv)  
- Quehenberger BORD512 / BT Swiss Status / Eberle VIP (aktiv, Config beachten)  
- eZoll CC529/CC599 + Mercurio e-dec PDF (aktiv)  
- Impersonation ORG_ADMIN Kundenansicht (umgesetzt)  
- Wiederkehrende Vorlagen, Abweichungs-Cockpit, Audit (Roadmap ✅)

---

*Nächste Aktualisierung: nach Abarbeitung Sprint 1 oder bei Merge der Agent-PR-Kette.*
