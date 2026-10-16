-- Empfänger-Kundennummer lt. Kundensystem (kein Soloplan-Feld)
ALTER TABLE "Address" ADD COLUMN "customerRef" TEXT;

-- Abholzeiten Mo–So als JSON, z. B. {"1":"08:00","2":"08:00","5":"14:00"}
ALTER TABLE "Address" ADD COLUMN "pickupTimesByWeekday" TEXT;

-- Kopie der Empfänger-Kundennummer auf die Sendung (für Etikett / Anzeige)
ALTER TABLE "Shipment" ADD COLUMN "deliveryCustomerRef" TEXT;
