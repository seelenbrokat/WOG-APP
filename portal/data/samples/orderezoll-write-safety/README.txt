OrderEzoll – Write-Safety Samples (Portal-Tests)
================================================

SFTP (User soloplan @ wog.logistikberater.at):
  outbound/soloplan/ezoll/samples-write-safety/

WICHTIG: Live-Pickup ist:
  outbound/soloplan/ezoll/consignment/
  outbound/soloplan/ezoll/tour/

Default JSON-Root: order (nested) – Ausgabe trotzdem nach consignment/
  Automate soll Order per number binden, dann consignments.itemNumber
  NUR innerhalb dieses Auftrags suchen.

--- Order-Root (empfohlen, Pfad = consignment/) ---

04-orderezoll-cc529-443153.1-ORDER-ROOT.json
  CC529: order[].number=443153 + consignments[].itemNumber=1

05-orderezoll-cc599-443153.1-ORDER-ROOT.json
  CC599: nur cC599C=true unter order.number + itemNumber

Automate-Job: weiterhin Pickup …/ezoll/consignment/, Mapping Order-Root.

--- Legacy flat consignment (nicht Default) ---

01-orderezoll-ez922-441929.1-LOOKUP.json
  EZ922: ordernumber = { "number": 441929 } + itemNumber
  Achtung: Automate scanned ASENDUNG oft zuerst per itemNumber (langsam/unsicher)

02-orderezoll-cc529-441929-LOOKUP.json
  CC529 flat: itemNumber=1 + ordernumber Lookup-Objekt

03-orderezoll-cc529-FALSCH-bare-integer.json
  NEGATIV – bare Integer → ObjectExpected (nicht an Automate senden)

Tour/CC029 → outbound/soloplan/ezoll/tour/
