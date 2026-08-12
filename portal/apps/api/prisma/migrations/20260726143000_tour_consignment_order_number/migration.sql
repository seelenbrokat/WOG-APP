-- Soloplan OrderNumber + Consignment-Index für Sendungsnummer (OrderNumber.1)
ALTER TABLE "TourConsignment" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "TourConsignment" ADD COLUMN "consignmentIndex" INTEGER;

CREATE INDEX "TourConsignment_orderNumber_idx" ON "TourConsignment"("orderNumber");
