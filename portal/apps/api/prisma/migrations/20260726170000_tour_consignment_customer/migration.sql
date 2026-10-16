-- Auftraggeber aus Soloplan TransportOrder.Customer / FreightPayer
ALTER TABLE "TourConsignment" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "TourConsignment" ADD COLUMN IF NOT EXISTS "customerBpNumber" TEXT;
ALTER TABLE "TourConsignment" ADD COLUMN IF NOT EXISTS "freightPayerName" TEXT;
ALTER TABLE "TourConsignment" ADD COLUMN IF NOT EXISTS "freightPayerBpNumber" TEXT;

CREATE INDEX IF NOT EXISTS "TourConsignment_customerBpNumber_idx"
  ON "TourConsignment"("customerBpNumber");
