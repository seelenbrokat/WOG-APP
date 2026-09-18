# Soloplan Verpackungs-Stammdaten

`verpackung.csv` – Ausschnitt aus Soloplan „Art des Lademittels“ inkl. Spalte **LM-Buchungen erzeugen**.

Import-Pfad (SFTP): `inbound/soloplan/master-data/` (Dateiname enthält `verpackung`).

Nur Zeilen mit **Ja** werden in der Lademittelverwaltung gebucht (`PackagingType.createBookings`).
