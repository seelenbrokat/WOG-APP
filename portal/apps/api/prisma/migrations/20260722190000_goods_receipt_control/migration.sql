-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'WAREHOUSE_PHOTO';

-- AlterTable ShipmentCollo
ALTER TABLE "ShipmentCollo" ADD COLUMN IF NOT EXISTS "warehouseStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ShipmentCollo" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "ShipmentCollo" ADD COLUMN IF NOT EXISTS "receivedById" TEXT;
ALTER TABLE "ShipmentCollo" ADD COLUMN IF NOT EXISTS "warehouseNote" TEXT;

CREATE INDEX IF NOT EXISTS "ShipmentCollo_warehouseStatus_idx" ON "ShipmentCollo"("warehouseStatus");

-- GoodsReceiptSession
CREATE TABLE IF NOT EXISTS "GoodsReceiptSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandantId" TEXT,
    "customerId" TEXT,
    "externalRef" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoodsReceiptSession_organizationId_sessionDate_idx" ON "GoodsReceiptSession"("organizationId", "sessionDate");
CREATE INDEX IF NOT EXISTS "GoodsReceiptSession_customerId_externalRef_idx" ON "GoodsReceiptSession"("customerId", "externalRef");
CREATE INDEX IF NOT EXISTS "GoodsReceiptSession_organizationId_externalRef_sessionDate_idx" ON "GoodsReceiptSession"("organizationId", "externalRef", "sessionDate");

-- GoodsReceiptColloCheck
CREATE TABLE IF NOT EXISTS "GoodsReceiptColloCheck" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "colloId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMP(3),
    "scannedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptColloCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceiptColloCheck_sessionId_colloId_key" ON "GoodsReceiptColloCheck"("sessionId", "colloId");
CREATE INDEX IF NOT EXISTS "GoodsReceiptColloCheck_sessionId_status_idx" ON "GoodsReceiptColloCheck"("sessionId", "status");

-- GoodsReceiptSurplus
CREATE TABLE IF NOT EXISTS "GoodsReceiptSurplus" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sscc" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedById" TEXT,
    "note" TEXT,
    "documentId" TEXT,

    CONSTRAINT "GoodsReceiptSurplus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoodsReceiptSurplus_sessionId_idx" ON "GoodsReceiptSurplus"("sessionId");
CREATE INDEX IF NOT EXISTS "GoodsReceiptSurplus_sscc_idx" ON "GoodsReceiptSurplus"("sscc");

-- FKs (ignore if already exist)
DO $$ BEGIN
  ALTER TABLE "GoodsReceiptSession" ADD CONSTRAINT "GoodsReceiptSession_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GoodsReceiptColloCheck" ADD CONSTRAINT "GoodsReceiptColloCheck_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "GoodsReceiptSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GoodsReceiptColloCheck" ADD CONSTRAINT "GoodsReceiptColloCheck_colloId_fkey"
    FOREIGN KEY ("colloId") REFERENCES "ShipmentCollo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GoodsReceiptSurplus" ADD CONSTRAINT "GoodsReceiptSurplus_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "GoodsReceiptSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
