-- Externe Auftragsnummer (VLB…) für Verzollungsaufträge, analog TransportOrder
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "externalNumber" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "soloplanRef" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CustomsOrder_organizationId_externalNumber_key"
  ON "CustomsOrder"("organizationId", "externalNumber");

CREATE INDEX IF NOT EXISTS "CustomsOrder_externalNumber_idx"
  ON "CustomsOrder"("externalNumber");
