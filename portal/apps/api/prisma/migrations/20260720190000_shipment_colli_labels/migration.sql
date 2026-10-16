-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'LABEL';

-- CreateTable
CREATE TABLE "ShipmentCollo" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "sscc" TEXT NOT NULL,
    "content" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentCollo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsccSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nextSerial" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsccSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentCollo_sscc_key" ON "ShipmentCollo"("sscc");

-- CreateIndex
CREATE INDEX "ShipmentCollo_shipmentId_idx" ON "ShipmentCollo"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentCollo_shipmentId_itemNumber_key" ON "ShipmentCollo"("shipmentId", "itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SsccSequence_organizationId_key" ON "SsccSequence"("organizationId");

-- AddForeignKey
ALTER TABLE "ShipmentCollo" ADD CONSTRAINT "ShipmentCollo_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
