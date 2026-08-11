OrderEzoll-Updates aus dem Portal (eZoll-PDF-Analyse).

Ordner:
  order/        → nested header + order[] (Default, SOLOPLAN_EZOLL_ROOT=order)
  consignment/  → flach header + consignment[] (Legacy)
  tour/         → header + tour[] (CC029)
  samples-write-safety/ → NUR Tests, kein Automate-Pickup

Automate (empfohlen):
  Job auf order/ mit Order-Root:
  1) Order per number suchen
  2) Sendung (itemNumber) nur innerhalb dieses Auftrags
