OrderEzoll-Updates aus dem Portal (eZoll-PDF-Analyse).

Ordner:
  consignment/  → Pickup für Auftrag/Sendung (JSON-Root: order nested oder flat)
  tour/         → header + tour[] (CC029)
  samples-write-safety/ → Referenz-Samples

Default SOLOPLAN_EZOLL_ROOT=order:
  nested order.number + consignments.itemNumber
  Ausgabe trotzdem nach consignment/ (Automate-Pfad unverändert)
