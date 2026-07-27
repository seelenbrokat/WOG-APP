-- AlterTable Shipment: Zustellung bis (deliveryDateEnd)
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveryDateEnd" TIMESTAMP(3);
