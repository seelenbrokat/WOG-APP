# Mercurio-Dokumente – SFTP-Eingang

Eigener SFTP-Drop für Dokumente aus **Mercurio** (PDF; später ggf. XML).

## Zugang

| | |
|--|--|
| Host | `wog.logistikberater.at` |
| Port | `22` |
| User | `wogmercurio` |
| Pfad | `inbound/Mercurio-Dokumente/` |
| Credentials (Server) | `/root/wog-mercurio-sftp.txt` |

Nach Login landet man direkt im Drop-Ordner.

## Ordner

```
portal/data/sftp/inbound/Mercurio-Dokumente/
  README.txt
  processed/
  failed/
```

Verwandt: eZoll-Drop → [EZOLL_PDF_SFTP.md](./EZOLL_PDF_SFTP.md)
