OrderEzollDuplicat-v5 – Write-Safety Samples (Portal-Tests)
==========================================================

SFTP (User soloplan @ wog.logistikberater.at):
  outbound/soloplan/ezoll/samples-write-safety/

01-orderezoll-ez922-441929.1-LOOKUP.json
  EZ922: ordernumber = { "number": 441929 } + itemNumber + Abgabenfelder

02-orderezoll-cc529-441929-LOOKUP.json
  CC529 order-only: itemNumber=1 + ordernumber Lookup-Objekt

03-orderezoll-cc529-FALSCH-bare-integer.json
  NEGATIV – bare Integer → ObjectExpected (nicht an Automate senden)

Tour-Match erzeugt kein Consignment-Update (wird abgelehnt).
Tour/CC029 → outbound/soloplan/ezoll/tour/
