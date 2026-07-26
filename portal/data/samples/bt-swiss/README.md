# Soloplan BT Swiss Tour-Export (v3)

Namespace: `http://soloplan.de/SoloplanTourInOutBTSwiss.v3`

Beispiel: `TourData_184491_BTSwiss_v3.xml`

- Tour **184491** / ExtTourNumber **56440**
- Carrier: BT SWISS AG (`BTDIELS`), Truck `BT-SWISS`
- Kennzeichen am Tour-Level: `AdditionalInfo/Info15 = BT`

## Lademittel-relevante Felder

| Quelle | Bedeutung |
|--------|-----------|
| `TransportOrderLoadingUnits` / `LoadingUnit.Matchcode` + `Quantity` | geplante Lademittel (EUP, HP, EWP, …) |
| `TransportOrderItems/Package.Matchcode` + `Quantity` | Verpackung / Fallback wenn keine LoadingUnits |
| `Information/Info9` | z. B. `EUP 0` (Hinweis Tausch/Soll) |
| `TourStops`: `Type` 0 = Ladung, 1 = Lieferung | Stop-Richtung für Saldo |
| `DifferentLoadingPoint` | physischer Ladepunkt ≠ Sender |
| Partner-`Matchcode` / `BusinessPartnerId` | Zuordnung Partner-Saldo |

Geplanter Inbound später: `inbound/wareneingang/…` (SFTP), eigener Parser – nicht StdTelematics.
