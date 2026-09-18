-- CreateEnum
CREATE TYPE "CustomsRefSource" AS ENUM (
  'EZOLL_CC529',
  'EZOLL_CC599',
  'EZOLL_EZ922',
  'EZOLL_EZ923',
  'EZOLL_CC029',
  'SMARTBORDER_CCATBT02',
  'SMARTBORDER_CCATBT12',
  'MERCURIO_CH'
);

-- CreateTable
CREATE TABLE "ShipmentCustomsRef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "consignmentIndex" INTEGER NOT NULL DEFAULT 1,
    "tourNumber" TEXT,
    "source" "CustomsRefSource" NOT NULL,
    "mrn" TEXT,
    "lrn" TEXT,
    "sourceFileName" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentCustomsRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentCustomsRef_shipmentId_idx" ON "ShipmentCustomsRef"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentCustomsRef_lastSeenAt_idx" ON "ShipmentCustomsRef"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ShipmentCustomsRef_organizationId_lastSeenAt_idx" ON "ShipmentCustomsRef"("organizationId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ShipmentCustomsRef_mrn_idx" ON "ShipmentCustomsRef"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentCustomsRef_organizationId_orderNumber_consignmentIndex_source_key"
  ON "ShipmentCustomsRef"("organizationId", "orderNumber", "consignmentIndex", "source");

-- AddForeignKey
ALTER TABLE "ShipmentCustomsRef" ADD CONSTRAINT "ShipmentCustomsRef_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShipmentCustomsRef" ADD CONSTRAINT "ShipmentCustomsRef_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
