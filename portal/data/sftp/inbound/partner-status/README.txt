WOG Portal – Partner-Statusmeldungen (SFTP)
==========================================

Pro Partner (z. B. BT Swiss) existiert ein Unterordner:

  partner-status/{sftpUsername}/

Ablage:
  Dateien direkt in partner-status/{user}/ legen.
  Verarbeitet → processed/
  Fehler      → failed/

Unterstütztes Format:
  FORTRAS STAT512 (Package-Header @@PHSTAT512)
  → Soloplan StdTelematics TransportOrderStatus

Beispiel BT Swiss:
  User:   btswiss
  Pfad:   inbound/partner-status/btswiss/
  Format: STAT512

OS-User auf dem Server anlegen:
  sudo bash portal/scripts/provision-partner-status-sftp.sh btswiss

Doku: portal/docs/BT_SWISS_STATUS_SFTP.md
