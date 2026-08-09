# eZoll PDF – SFTP-Eingang

Eigener SFTP-Drop für PDF-Dokumente aus **eZoll**. Zuerst Upload/Analyse,
danach Anbindung an Portal-/Soloplan-Weiterverarbeitung.

## Zugang

| | |
|--|--|
| Host | `wog.logistikberater.at` |
| Port | `22` |
| User | `wogezoll` |
| Pfad | `inbound/ezoll/` |
| Credentials (Server) | `/root/wog-ezoll-sftp.txt` |

Nach Login landet man direkt im Drop-Ordner.

## Ordner

```
portal/data/sftp/inbound/ezoll/
  README.txt
  processed/
  failed/
```

## Provisioning (falls neu)

```bash
# User + sshd Match analog Quehenberger/wogdocs
# Chroot: /opt/wog-portal/portal/data/sftp
# ForceCommand: internal-sftp -d /inbound/ezoll
```

## Anmeldearten & Kategorien

Fachliche Grundlage für die PDF-Zuordnung:

→ [EZOLL_ZOLL_ANMELDEARTEN.md](./EZOLL_ZOLL_ANMELDEARTEN.md)

Kurz: **IE599 / Ausfuhranzeige** → `CUSTOMS_EXIT`; ABD/Freigabe/TAD → Zollpapier; EZ922 Abgabenbescheid → später eigene Kategorie.

## Nächste Schritte

1. Beispiel-PDFs aus eZoll hochladen  
2. Dateinamen-/Inhaltsanalyse gegen die Tabelle in `EZOLL_ZOLL_ANMELDEARTEN.md`  
3. Worker-Ingest (Zuordnung Sendung/Auftrag, Dokumentenkategorie)
