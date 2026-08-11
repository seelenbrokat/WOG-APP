WOG Portal – Kunden-/Partner-Auftragsimport (SFTP)
=================================================

Pro freigeschaltetem Kunden/Partner existiert ein Unterordner:

  partner-orders/{sftpUsername}/

Nur Admin schaltet SFTP je Kunde/Partner im Portal frei
(Kundenverwaltung → „SFTP-Inbound freischalten“). Nicht pauschal aktiv.

Ablage:
  Dateien direkt in partner-orders/{user}/ legen (Drop-Ordner).
  Verarbeitet → processed/
  Fehler      → failed/

Unterstütztes Format (Quehenberger / System Alliance):
  FORTRAS BORD512 (Package-Header @@PHBORD512)

Verarbeitung:
  Worker liest die Datei, transformiert nach Soloplan OrderImportPORTAL v6
  und legt je Sendung einen Auftrag (eigene JSON) nach:

    outbound/soloplan/orders/order-{Sendungsnummer}.json

Beispiel Quehenberger:
  User:   quehenberger
  Pfad:   inbound/partner-orders/quehenberger/
  Format: BORD512

OS-User auf dem Server anlegen:
  sudo bash portal/scripts/provision-partner-sftp.sh quehenberger
