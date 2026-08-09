# Österreichischer Zoll: Anmeldearten, Rückmeldungen, Dokumentkategorien

Grundlage für die Zuordnung von **eZoll-/ACCS-/Smart-Border-PDFs** zu Portal-Kategorien  
(SFTP `inbound/Ezoll-Dokumente/`). Stand: BMF/WKO-Informationen 2025/2026; e-zoll wird durch **ACCS** abgelöst.

## 1. Systeme (Österreich)

| System | Zweck | Status |
|--------|--------|--------|
| **e-zoll** | bisheriges AT-Informatikverfahren | Parallelbetrieb Auslauf |
| **ACCS** | Austrian Customs Clearance System | Nachfolger |
| **AES** | Automated Export System (Ausfuhr) | Teil von ACCS |
| **AIS** | Automated Import System (Einfuhr) | Teil von ACCS |
| **NCTS** | Versand (T1/T2/TIR) | ACCS, Phase 5/6 |
| **Smart Border Austria** | Digitale Grenzvoranmeldung AT↔CH/LI (Korridor) | Regelbetrieb; baut auf AES/NCTS auf |

Referenzen: MRN (Master/Movement Reference Number), LRN (lokale Bezugsnummer),  
FRN (Fallback Reference Number bei Systemausfall), EORI, JourneyId / BTN (Smart Border).

---

## 2. Anmeldearten (was wird angemeldet)

### 2.1 Ausfuhr (Export) – AES / früher ECS

| Art | Kurz | Typische Codes / Nachrichten |
|-----|------|------------------------------|
| Vollständige Ausfuhranmeldung | Standardausfuhr | IE515 → Annahme/MRN → Überlassung → Ausgang |
| Vereinfachte / unvollständige Ausfuhr | mit ergänzender Anmeldung | Art. ergänzende Anmeldung D/E/F |
| Anschreibeverfahren (Export) | verzögerte ergänzende Anmeldung | national bewilligt |
| Zentrale Zollabwicklung Ausfuhr (CCE) | Gestellung in anderem MS | Bewilligungscode C513 / 0CCL |
| Kleinsendung / mündlich | oft ohne AES | z. B. ≤ 1 000 € / ≤ 1 000 kg (Sonderregeln) |
| Carnet ATA (vorübergehende Ausfuhr) | ATA statt Einheitspapier | gelbe Abschnitte |

### 2.2 Einfuhr (Import) – AIS / e-zoll Import

| Art | Kurz | Typische Software-Codes* |
|-----|------|---------------------------|
| Überlassung zum zollrechtlich freien Verkehr | „Normalimport“ | IMD / IMA (vollständige Anmeldung) |
| Vereinfachte Einfuhr / Anschreibung | bewilligungsabhängig | je Software |
| Zentrale Zollabwicklung Einfuhr (CCI) | AIS-Zielbild | – |
| Besondere Verfahren nach Einfuhr | Zolllager, AV, PV, Endverwendung … | Verfahrenscodes |
| Mündlich / Reiseverkehr | Schwellen WKO | ohne Informatik |

\*Bezeichnungen in Zollsoftware (Mercurio, LDV, DAKOSY …) können abweichen; inhaltlich zählen **Annahme / Freigabe / Abgabenbescheid**.

### 2.3 Versand – NCTS

| Art | Kurz | Nachrichten (Auswahl) |
|-----|------|------------------------|
| Externes Versandverfahren T1 | Nichtunionsware | IE015 Anmeldung, IE001/IE029 … |
| Internes Versandverfahren T2 | Unionsware | dito |
| TIR | Straßen-TIR | NCTS-TIR |
| Export followed by Transit | Ausfuhr-MRN als Vorpapier N830 | AES↔NCTS Cross-Check |
| Zugelassener Versender/Empfänger | Vereinfachung | Bewilligung |

### 2.4 Summarische / Sicherheit

| Art | Richtung | Hinweis |
|-----|----------|---------|
| ENS (ESumA) | Eingang | Sicherheit vor Ankunft |
| EXS / ASumA | Ausgang | oft mit Versand kombiniert |
| Vorübergehende Verwahrung | nach Gestellung | bis Überlassung |

### 2.5 Fallback (Notfall)

Bei Systemausfall: Papieranmeldung + **FRN** (z. B. `F14AT012345A000001`), Betreff mit Team/IM/EX/TR.

### 2.6 Smart Border Austria (Korridor / Grenzvoranmeldung)

Kein eigenes Zollverfahren statt Ausfuhr/Einfuhr/Versand, sondern die **elektronische Voranmeldung und Überwachung des Grenzübertritts** AT ↔ CH/LI.  
Voraussetzung: passende AES-/NCTS-MRNs (Ausfuhr oft Status **G51** nach **IE525** „Überlassung zum Ausgang“).

| Prozess | Richtung | Kurz | Typische Nachrichten |
|---------|----------|------|----------------------|
| **Warenort Korridor – Eingang** | CH/LI → AT | Voranmeldung am zugelassenen Warenort Eingang | IEATBT01 → IEATBT02 (+ **GZS-ES** PDF) → IEATBT03…05 |
| **Warenort Korridor – Ausgang** | AT → CH/LI | Voranmeldung Ausgang am Warenort | IE507/IE525 (AES) → IEATBT51 → IEATBT52 (+ Schein) → Grenzübertritt → IE590/IE599 |
| **Rollender Korridor – Ausgang** | AT → CH/LI | rollende Voranmeldung / AES-Abschluss | IEATBT41/42, **IEATBT46** Meldung AES-Abschluss → **IEATBT47** (+ **GZS-AS** PDF) |
| **Transit – Eingang** | CH/LI → AT (NCTS) | Voranmeldung Transit Eingang | IEATBT11 → IEATBT12 (+ **TES** Transit-Eingangsschein PDF) |
| Stornierung | je Prozess | vor Grenzübertritt | IEATBT90 / IEATBT91; Fehler IEATBT99 |

Kennzeichen / Fahrzeugdaten und Grenzstelle sind Teil der Smart-Border-Voranmeldung (im Portal bereits als Verzollungs-/Smart-Border-Felder).

---

## 3. Rückmeldungen vom Zoll – wie sie heißen

PDFs aus eZoll/ACCS-Software sind meist **Ausdrucke dieser Nachrichten** (oft mit MRN im Titel/Inhalt).

### 3.1 Ausfuhr (AES) – für WOG besonders relevant

| Fachbegriff (DE) | Nachricht / Altname | Bedeutung | Portal-Kategorie (Vorschlag) |
|------------------|---------------------|-----------|------------------------------|
| Ausfuhranmeldung (Antrag) | IE515 | Anmeldung abgegeben | `OTHER` / intern |
| Annahme + **MRN** | Annahme / Registrierung | Vorgang läuft | `OTHER` oder Meta |
| **Ausfuhrbegleitdokument (ABD)** | IE529 / Freigabe mit ABD; e-zoll **EZ923** | Überlassung zur Ausfuhr; Begleitpapier bis Ausgang | `CUSTOMS_PAPER` (Begleitdokument) |
| Überlassung / Freigabe Ausfuhr | IE525 / EZ923 | Waren dürfen Richtung Ausgang | oft mit ABD zusammen |
| Ankunftsanzeige Ausgang | IE507 | bei Ausgangszollstelle | intern |
| Ergebnisse beim Ausgang | IE518 / IE590 | Zollstellen untereinander | intern |
| **Ausfuhranzeige / Ausfuhrmitteilung / Austrittsbestätigung** | **IE599** | **elektronischer Ausfuhrnachweis** (USt/Export) | **`CUSTOMS_EXIT`** |
| Dokumentenanforderung | nationale Dok.-Anfrage | Unterlagen nachreichen | `OTHER` |
| Ablehnung / Fehler | IE056 / Ablehnung | nicht angenommen | `OTHER` |
| Ungültigerklärung | IE510 u. a. | storniert | `OTHER` |

**Wichtig:** Der für Kunden oft entscheidende Beleg ist die **IE599 / Ausfuhranzeige** („Austritt bestätigt“). Das ist die Kategorie, die im Portal bereits als `CUSTOMS_EXIT` existiert.

Kontrollergebnis am Ausgang in IE599 (Auswahl):

| Code | Bedeutung |
|------|-----------|
| A1 / vergleichbar | Ausgang OK |
| **A4** | Ausgang trotz **geringfügiger** Unstimmigkeit |
| B1 | schwerwiegende Abweichung / Ausgang problematisch |

### 3.2 Einfuhr (AIS / e-zoll Import)

| Fachbegriff (DE) | Nachricht / Altname | Bedeutung | Portal-Kategorie (Vorschlag) |
|------------------|---------------------|-----------|------------------------------|
| Annahme | **EZ906** (e-zoll) | Anmeldung angenommen, oft mit Registriernr./MRN | `OTHER` / Meta |
| **Freigabe / Überlassung** | **EZ923** | Ware überlassen (freier Verkehr o. ä.) | `CUSTOMS_PAPER` oder künftig `CUSTOMS_RELEASE` |
| **Abgabenbescheid** | **EZ922** (Mitteilung Abgaben) | Zoll/EUSt/… festgesetzt | künftig `CUSTOMS_DUTY` / `OTHER` |
| Dokumentenanforderung | Dok.-Anfrage + Faxdeckblatt | Belege nachreichen | `OTHER` |

### 3.3 Versand (NCTS)

| Fachbegriff (DE) | Typische Bezeichnung | Portal-Kategorie (Vorschlag) |
|------------------|----------------------|------------------------------|
| Versandanmeldung / TAD | Transit Accompanying Document | `CUSTOMS_PAPER` |
| Überlassung zum Versand | Freigabe Abgang | `CUSTOMS_PAPER` |
| Ankunftsavis | IE006 o. ä. | `OTHER` |
| Entladeerlaubnis / Freigabe Bestimmung | | `CUSTOMS_PAPER` |
| Erledigung / Unstimmigkeiten | | `OTHER` |

### 3.4 Smart Border Austria – PDFs / Scheine

| Fachbegriff (DE) | Nachricht / Datei | Bedeutung | Portal-Kategorie (Vorschlag) |
|------------------|-------------------|-----------|------------------------------|
| **Grenzzollstellen-Eingangsschein (GZS-ES)** | IEATBT02 | Bestätigung Korridor Eingang | `CUSTOMS_PAPER` / künftig `SMART_BORDER` |
| **Transit-Eingangsschein (TES)** | IEATBT12 | Bestätigung Transit Eingang | `CUSTOMS_PAPER` / `SMART_BORDER` |
| **Korridorvoranmeldungsbestätigungsschein (KV-BS)** | IEATBT42 (rollend) | Bestätigung Voranmeldung Ausgang | `CUSTOMS_PAPER` / `SMART_BORDER` |
| **Grenzzollstellen-Ausgangsschein (GZS-AS)** | IEATBT47 | Bestätigung AES-Abschluss / Ausgang Korridor | `CUSTOMS_PAPER` / `SMART_BORDER` (nicht gleich IE599) |
| Korridorvoranmeldung / -bestätigung | IEATBT01/02, 11/12, 41/42, 51/52 | Prozessmeldungen | oft nur XML; PDF = Scheine oben |
| Grenzübertrittsbestätigung | IEATBT03 u. a. | physischer Übertritt gemeldet | Meta / `OTHER` |
| Storno / Fehler | IEATBT90/91/99 | abgebrochen | `OTHER` |

**Abgrenzung:** Smart-Border-Scheine (GZS/KV-BS/TES) ≠ **IE599 Ausfuhranzeige**.  
IE599 bleibt der zollrechtliche **Ausfuhrnachweis** (`CUSTOMS_EXIT`). Smart-Border-PDFs belegen den **Korridor-/Grenzprozess**.

---

## 4. Mapping für eZoll-PDF-Erkennung (Dateiname + Text)

Reihenfolge bei der späteren Analyse: **1)** eindeutige IE-/EZ-Codes, **2)** deutsche Titel, **3)** Kontext MRN/FRN.

| Erkennungsmerkmale (Beispiele) | Kategorie-Code | Label |
|--------------------------------|----------------|-------|
| `IE599`, `Ausfuhranzeige`, `Ausfuhrmitteilung`, `Austrittsbestätigung`, `Ausgangsbestätigung`, `Exit confirmation` | **CUSTOMS_EXIT** | Austrittsbestätigung / Ausfuhrnachweis |
| `ABD`, `Ausfuhrbegleitdokument`, `IE529`, `IE525`, `Überlassung zur Ausfuhr`, `Freigabe`+Ausfuhr | **CUSTOMS_PAPER** (oder CUSTOMS_EXIT nur wenn klar IE599) | Zollbegleitpapier Ausfuhr |
| `EZ923`, `Freigabe`, `Überlassung` (ohne Ausfuhrkontext) | **CUSTOMS_PAPER** | Freigabe / Überlassung |
| `EZ922`, `Abgabenbescheid`, `Mitteilung Abgaben`, `Art. 102` | **OTHER** → später eigene Kat. | Abgabenbescheid |
| `EZ906`, `Annahme`, `MRN` allein | **OTHER** / Meta | Annahme |
| `TAD`, `Versandanmeldung`, `NCTS`, `T1`, `T2` | **CUSTOMS_PAPER** | Versandbegleitdokument |
| `GZS-ES`, `GZS-AS`, `KV-BS`, `TES`, `IEATBT`, `Smart Border`, `Korridorvoranmeldung`, `Grenzzollstellen` | **CUSTOMS_PAPER** → später `SMART_BORDER` | Smart-Border-Schein |
| `Dokumentenanforderung`, `Dok.Anfrage` | **OTHER** | Dokumentenanforderung |
| Rechnung / Proforma (Begleitbeleg, kein Zollbescheid) | **INVOICE** | Rechnung |

Bestehende Portal-Kategorien (Kunden-Dokumente-Modul):

- `INVOICE`, `CUSTOMS_EXIT`, `POD`, `CMR`, `OTHER`

**Empfehlung für eZoll-Inbound:** `CUSTOMS_EXIT` strikt für **IE599 / Ausfuhranzeige**; ABD/Freigabe/TAD als `CUSTOMS_PAPER` (DocumentType); Abgabenbescheid ggf. später eigene Kategorie.

---

## 5. Typischer Ablauf Ausfuhr (was der Kunde als PDF sieht)

```
IE515 Anmeldung
    → Annahme + MRN
    → Überlassung + ABD (IE529 / EZ923)     ← PDF „Begleitdokument / Freigabe“
    → physischer Ausgang / NCTS-Übernahme
    → IE599 Ausfuhranzeige                  ← PDF „Austrittsbestätigung“ (= CUSTOMS_EXIT)
```

Einfuhr:

```
Anmeldung (IMD/IMA …)
    → EZ906 Annahme
    → EZ923 Freigabe + EZ922 Abgabenbescheid
```

Smart Border Ausgang (vereinfacht):

```
AES: IE515 → … → IE525 (Status G51)
    → Korridorvoranmeldung (IEATBT41/51 …)
    → Bestätigung + Schein (KV-BS / GZS-AS, IEATBT42/47)
    → Grenzübertritt
    → AES: IE590 / IE599 Ausfuhranzeige   ← CUSTOMS_EXIT
```

---

## 6. Nächste Schritte mit den eZoll-Uploads

1. Beispiel-PDFs nach `inbound/Ezoll-Dokumente/` legen (User `wogezoll`).
2. Pro Datei: Titel, IE-/EZ-/IEATBT-Code, MRN, Anmeldeart (EX/IM/TR/Smart Border) aus Text extrahieren.
3. Alias-Tabelle in `customer-doc-categories.ts` / eZoll-Parser um obige Merkmale erweitern.
4. Optional neue Enum-Werte: `CUSTOMS_RELEASE`, `CUSTOMS_DUTY`, `CUSTOMS_TRANSIT`, `SMART_BORDER`.

Quellen (Auswahl): WKO „Formen der Zollanmeldung“, BMF AES-Leitfaden, WKO Ausfuhrnachweise (IE599), BMF NCTS-Infos, BMF Smart Border Austria (Technische Ablaufdokumentation, Testspezifikation), e-zoll-Nachrichten EZ906/EZ922/EZ923 in Zollsoftware-Dokus.
