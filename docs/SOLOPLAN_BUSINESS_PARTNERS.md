# Soloplan BusinessPartner → Portal-User

Externe Kunden und Partner müssen zuerst in **Soloplan** als BusinessPartner existieren.
Die **BusinessPartnerId** wird für spätere Auftragsanlage und Integrationen benötigt.

## Import

1. Soloplan-Export hochladen, unterstützt:
   - PORTALGP-Export mit `{ header, businessPartner: [...] }` (camelCase, `contactPersons[].emailAddress`)
   - PascalCase-Tour-JSON mit `OriginalBusinessPartner` / `BusinessPartner`
   - NDJSON (ein JSON-Objekt pro Zeile)
2. Im Portal unter **Kunden** als Admin hochladen  
   oder per **SFTP** nach `inbound/soloplan/business-partners/` legen (Worker importiert automatisch)

### SFTP-Upload (GPPortal / BusinessPartner)

| Feld | Wert |
|------|------|
| Protokoll | **SFTP** (nicht FTP) |
| Host | `wog.logistikberater.at` |
| Port | `22` |
| Benutzer | `soloplan` |
| Passwort | siehe Server `/root/wog-soloplan-sftp.txt` |
| Remote-Pfad | `inbound/soloplan/business-partners/` |

Dateiname z. B. `PORTALGP.v1-BusinessPartner_….json`. Nach Import verschiebt der Worker die Datei nach `…/processed/`.
3. Ansprechpartner (`MainContactPerson` / `ContactPersons`) werden als Kontakte gespeichert

## Portal-User

- Administrator legt User aus Kontakt-E-Mail an („User anlegen“) oder manuell mit Zuordnung zum Soloplan-Kunden
- **Standardpasswort:** `DEFAULT_USER_PASSWORD` (Default `WillkommenWOG1!`)
- User muss Passwort beim ersten Login ändern (`mustChangePassword`)
- Admin kann Passwort jederzeit zurücksetzen (neues Standardpasswort + Force-Change)

## API

- `GET /integrations/soloplan/business-partners`
- `POST /integrations/soloplan/business-partners/import` `{ payload, kind? }`
- `POST /integrations/soloplan/business-partners/import-file` (multipart `file`, `kind`)
- `POST /users/invite-from-contact` `{ contactId, role? }`
- `POST /users/:id/reset-password`
- `POST /auth/change-password`

## Hinweis zur Beispieldatei

Die lokale Datei `PORTALGP.v1-BusinessPartner_….json` aus Downloads kann direkt importiert werden.
Ein Sample liegt unter `portal/data/samples/PORTALGP.v1-BusinessPartner_sample.json`.
