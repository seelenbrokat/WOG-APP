# eZoll-Dokumente – SFTP-Eingang

Eigener SFTP-Drop für Dokumente aus **eZoll** (PDF jetzt, XML später).  
Zuerst Upload/Analyse, danach Anbindung an Portal-/Soloplan-Weiterverarbeitung.

## Zugang

| | |
|--|--|
| Host | `wog.logistikberater.at` |
| Port | `22` |
| User | `wogezoll` |
| Pfad | `inbound/Ezoll-Dokumente/` |
| Credentials (Server) | `/root/wog-ezoll-sftp.txt` |

Nach Login landet man direkt im Drop-Ordner.

## Ordner

```
portal/data/sftp/inbound/Ezoll-Dokumente/
  README.txt
  processed/
  failed/
```

Verwandt: Mercurio-Drop → [MERCURIO_PDF_SFTP.md](./MERCURIO_PDF_SFTP.md)

## Anmeldearten & Kategorien

Fachliche Grundlage für die PDF-Zuordnung (inkl. **Smart Border Austria**):

→ [EZOLL_ZOLL_ANMELDEARTEN.md](./EZOLL_ZOLL_ANMELDEARTEN.md)

Kurz: **IE599 / Ausfuhranzeige** → `CUSTOMS_EXIT`; ABD/Freigabe/TAD → Zollpapier;  
Smart-Border-Scheine (GZS/KV-BS/TES) → Zollpapier / später `SMART_BORDER`; EZ922 Abgabenbescheid → später eigene Kategorie.

## Nächste Schritte

1. Beispiel-PDFs aus eZoll hochladen  
2. Dateinamen-/Inhaltsanalyse gegen die Tabelle in `EZOLL_ZOLL_ANMELDEARTEN.md`  
3. Worker-Ingest (Zuordnung Sendung/Auftrag, Dokumentenkategorie); XML-Parsing ergänzen
