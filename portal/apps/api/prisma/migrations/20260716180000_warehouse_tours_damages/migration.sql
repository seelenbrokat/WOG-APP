-- AlterEnum UserRole
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'WAREHOUSE_STAFF';

-- AlterEnum DocumentType
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'WAREHOUSE_PHOTO';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'DAMAGE_PHOTO';

-- CreateEnum DamageStatus
DO $$ BEGIN
  CREATE TYPE "DamageStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable Document
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "damageId" TEXT;

-- CreateIndex Document.damageId
CREATE INDEX IF NOT EXISTS "Document_damageId_idx" ON "Document"("damageId");

-- CreateIndex Shipment dates
CREATE INDEX IF NOT EXISTS "Shipment_pickupDate_idx" ON "Shipment"("pickupDate");
CREATE INDEX IF NOT EXISTS "Shipment_deliveryDate_idx" ON "Shipment"("deliveryDate");

-- CreateTable Tour
CREATE TABLE IF NOT EXISTS "Tour" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Tour_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Tour_organizationId_mandantId_date_key" ON "Tour"("organizationId", "mandantId", "date");
CREATE INDEX IF NOT EXISTS "Tour_organizationId_date_idx" ON "Tour"("organizationId", "date");

-- CreateTable TourShipment
CREATE TABLE IF NOT EXISTS "TourShipment" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TourShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TourShipment_tourId_shipmentId_key" ON "TourShipment"("tourId", "shipmentId");
CREATE INDEX IF NOT EXISTS "TourShipment_shipmentId_idx" ON "TourShipment"("shipmentId");

-- CreateTable WarehouseNote
CREATE TABLE IF NOT EXISTS "WarehouseNote" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "tourId" TEXT,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WarehouseNote_shipmentId_createdAt_idx" ON "WarehouseNote"("shipmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "WarehouseNote_tourId_idx" ON "WarehouseNote"("tourId");

-- CreateTable Damage
CREATE TABLE IF NOT EXISTS "Damage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DamageStatus" NOT NULL DEFAULT 'OPEN',
    "location" TEXT,
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Damage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Damage_organizationId_status_createdAt_idx" ON "Damage"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Damage_shipmentId_idx" ON "Damage"("shipmentId");

-- FKs
DO $$ BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_damageId_fkey"
    FOREIGN KEY ("damageId") REFERENCES "Damage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Tour" ADD CONSTRAINT "Tour_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Tour" ADD CONSTRAINT "Tour_mandantId_fkey"
    FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TourShipment" ADD CONSTRAINT "TourShipment_tourId_fkey"
    FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TourShipment" ADD CONSTRAINT "TourShipment_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "WarehouseNote" ADD CONSTRAINT "WarehouseNote_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "WarehouseNote" ADD CONSTRAINT "WarehouseNote_tourId_fkey"
    FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Damage" ADD CONSTRAINT "Damage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Damage" ADD CONSTRAINT "Damage_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
