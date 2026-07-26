-- AlterTable
ALTER TABLE "Address" ADD COLUMN "usage" TEXT NOT NULL DEFAULT 'BOTH';
ALTER TABLE "Address" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Address" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Address_customerId_idx" ON "Address"("customerId");

-- CreateTable
CREATE TABLE "ShipmentTemplate" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mandantId" TEXT,
    "reference" TEXT,
    "transportMode" TEXT,
    "goodsDescription" TEXT,
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DOUBLE PRECISION,
    "volumeM3" DOUBLE PRECISION,
    "pickupAddressId" TEXT,
    "deliveryAddressId" TEXT,
    "pickupCompany" TEXT,
    "pickupStreet" TEXT,
    "pickupZip" TEXT,
    "pickupCity" TEXT,
    "pickupCountry" TEXT DEFAULT 'AT',
    "deliveryCompany" TEXT,
    "deliveryStreet" TEXT,
    "deliveryZip" TEXT,
    "deliveryCity" TEXT,
    "deliveryCountry" TEXT DEFAULT 'AT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShipmentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentTemplate_customerId_idx" ON "ShipmentTemplate"("customerId");

ALTER TABLE "ShipmentTemplate" ADD CONSTRAINT "ShipmentTemplate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
