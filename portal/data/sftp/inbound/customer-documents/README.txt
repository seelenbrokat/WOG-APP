WOG Portal – Kunden-Dokumente (SFTP Inbound)
============================================

Ablage für Soloplan / Zollprogramm → Kunden-Download im Portal.

Dateiname (empfohlen):
  {Sendungsreferenz}__{KATEGORIE}__{Originalname}.pdf

Beispiele:
  948074__CUSTOMS_EXIT__Austrittsbestaetigung.pdf
  WOG2607A2E6B0__INVOICE__Rechnung.pdf
  2291__POD__Ablieferbeleg.pdf

Referenz = Soloplan-Auftragsnummer, Trackingnummer, externe Auftragsnummer
oder Sendungsreferenz der Portal-Sendung.

Kategorien:
  INVOICE       Rechnung
  CUSTOMS_EXIT  Austrittsbestätigung Verzollung
  POD           Abliefernachweis / POD
  CMR           CMR
  OTHER         Sonstiges

Aliases u. a.: RECHNUNG, RG, AUSTRITT, EXIT, ABLIEFERBELEG, CHBEL

Optional Unterordner:
  customer-documents/INVOICE/
  customer-documents/CUSTOMS_EXIT/
  … Dateiname beginnt dann mit der Referenz (z. B. 948074_….pdf)

Verarbeitet → processed/
Fehler      → failed/

Hinweis: Das Dokumente-Modul und die jeweilige Kategorie müssen
für den Kunden im Portal freigeschaltet sein.
