OrderEzoll – Write-Safety Samples (Portal-Tests)
================================================

SFTP (User soloplan @ wog.logistikberater.at):
  outbound/soloplan/ezoll/samples-write-safety/

WICHTIG: Niemals in live Pickup legen:
  outbound/soloplan/ezoll/order/
  outbound/soloplan/ezoll/consignment/
  outbound/soloplan/ezoll/tour/

Default-Root ab jetzt: order (nested)
  Automate soll Order per number binden, dann consignments.itemNumber
  NUR innerhalb dieses Auftrags suchen.

--- Order-Root (empfohlen) ---

04-orderezoll-cc529-443153.1-ORDER-ROOT.json
  CC529: order[].number=443153 + consignments[].itemNumber=1

05-orderezoll-cc599-443153.1-ORDER-ROOT.json
  CC599: nur cC599C=true unter order.number + itemNumber

Automate-Job: OrderEzoll mit Root=Order (nicht flaches Consignment).
Pickup-Ordner Portal: outbound/soloplan/ezoll/order/

--- Legacy flat consignment (nicht Default) ---

01-orderezoll-ez922-441929.1-LOOKUP.json
  EZ922: ordernumber = { "number": 441929 } + itemNumber
  Achtung: Automate scanned ASENDUNG oft zuerst per itemNumber (langsam/unsicher)

02-orderezoll-cc529-441929-LOOKUP.json
  CC529 flat: itemNumber=1 + ordernumber Lookup-Objekt

03-orderezoll-cc529-FALSCH-bare-integer.json
  NEGATIV – bare Integer → ObjectExpected (nicht an Automate senden)

Tour/CC029 → outbound/soloplan/ezoll/tour/
