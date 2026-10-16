WOG Portal – Partner-Statusmeldungen (SFTP)
==========================================

Pro Partner (z. B. BT Swiss) existiert ein Unterordner:

  partner-status/{sftpUsername}/

Ablage:
  Dateien direkt in partner-status/{user}/ legen.
  Verarbeitet → processed/
  Fehler      → failed/

Unterstützte Formate:
  1) BT Swiss Cargo-Status-XML (<status><shipment event="C50" …>)
  2) FORTRAS STAT512 (Package-Header @@PHSTAT512)
  → Soloplan StdTelematics TransportOrderStatus
  → bei Unterschrift/Foto: Ablieferbeleg-PDF (Document)

Beispiel BT Swiss:
  User:   btswiss
  Pfad:   inbound/partner-status/btswiss/
  Format: Cargo-XML (Live) oder STAT512

OS-User auf dem Server anlegen:
  sudo bash portal/scripts/provision-partner-status-sftp.sh btswiss

Doku: portal/docs/BT_SWISS_STATUS_SFTP.md
