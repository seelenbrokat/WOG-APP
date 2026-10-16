-- CreateEnum
CREATE TYPE "WarehousePalletType" AS ENUM ('EURO', 'HALF', 'OVERSIZE');

-- CreateEnum
CREATE TYPE "WarehouseLocationKind" AS ENUM ('RACK', 'BLOCK');

-- CreateEnum
CREATE TYPE "WarehouseUnitStatus" AS ENUM ('STORED', 'RELEASED');

-- CreateEnum
CREATE TYPE "WarehouseMovementType" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "WarehouseLocationKind" NOT NULL DEFAULT 'RACK',
    "aisle" INTEGER,
    "level" INTEGER,
    "bay" INTEGER,
    "slot" INTEGER,
    "label" TEXT,
    "capacitySlots" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseStorageUnit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "palletType" "WarehousePalletType" NOT NULL DEFAULT 'EURO',
    "slotUnits" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "articleName" TEXT,
    "serialNumber" TEXT,
    "sscc" TEXT,
    "externalRef" TEXT,
    "notes" TEXT,
    "status" "WarehouseUnitStatus" NOT NULL DEFAULT 'STORED',
    "storedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "storedById" TEXT,
    "releasedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseStorageUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storageUnitId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "WarehouseMovementType" NOT NULL,
    "palletType" "WarehousePalletType" NOT NULL,
    "slotUnits" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "articleName" TEXT,
    "serialNumber" TEXT,
    "shipmentId" TEXT,
    "note" TEXT,
    "performedById" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehousePriceRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "palletType" "WarehousePalletType" NOT NULL,
    "inboundFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outboundFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storageFeePerSlot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehousePriceRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseLocation_organizationId_code_key" ON "WarehouseLocation"("organizationId", "code");
CREATE INDEX "WarehouseLocation_organizationId_kind_active_idx" ON "WarehouseLocation"("organizationId", "kind", "active");
CREATE INDEX "WarehouseLocation_organizationId_aisle_level_bay_slot_idx" ON "WarehouseLocation"("organizationId", "aisle", "level", "bay", "slot");

CREATE INDEX "WarehouseStorageUnit_organizationId_status_customerId_idx" ON "WarehouseStorageUnit"("organizationId", "status", "customerId");
CREATE INDEX "WarehouseStorageUnit_organizationId_locationId_status_idx" ON "WarehouseStorageUnit"("organizationId", "locationId", "status");
CREATE INDEX "WarehouseStorageUnit_serialNumber_idx" ON "WarehouseStorageUnit"("serialNumber");
CREATE INDEX "WarehouseStorageUnit_sscc_idx" ON "WarehouseStorageUnit"("sscc");
CREATE INDEX "WarehouseStorageUnit_shipmentId_idx" ON "WarehouseStorageUnit"("shipmentId");

CREATE INDEX "WarehouseMovement_organizationId_customerId_occurredAt_idx" ON "WarehouseMovement"("organizationId", "customerId", "occurredAt");
CREATE INDEX "WarehouseMovement_organizationId_type_occurredAt_idx" ON "WarehouseMovement"("organizationId", "type", "occurredAt");
CREATE INDEX "WarehouseMovement_storageUnitId_idx" ON "WarehouseMovement"("storageUnitId");

CREATE UNIQUE INDEX "WarehousePriceRate_customerId_palletType_key" ON "WarehousePriceRate"("customerId", "palletType");
CREATE INDEX "WarehousePriceRate_organizationId_customerId_idx" ON "WarehousePriceRate"("organizationId", "customerId");

ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseStorageUnit" ADD CONSTRAINT "WarehouseStorageUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseStorageUnit" ADD CONSTRAINT "WarehouseStorageUnit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStorageUnit" ADD CONSTRAINT "WarehouseStorageUnit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseMovement" ADD CONSTRAINT "WarehouseMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseMovement" ADD CONSTRAINT "WarehouseMovement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseMovement" ADD CONSTRAINT "WarehouseMovement_storageUnitId_fkey" FOREIGN KEY ("storageUnitId") REFERENCES "WarehouseStorageUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseMovement" ADD CONSTRAINT "WarehouseMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehousePriceRate" ADD CONSTRAINT "WarehousePriceRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehousePriceRate" ADD CONSTRAINT "WarehousePriceRate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
