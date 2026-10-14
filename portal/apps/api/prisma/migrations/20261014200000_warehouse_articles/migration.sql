-- AlterEnum
ALTER TYPE "WarehousePalletType" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- CreateTable
CREATE TABLE IF NOT EXISTS "WarehouseArticle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "articleNumber" TEXT,
    "name" TEXT NOT NULL,
    "palletType" "WarehousePalletType" NOT NULL DEFAULT 'EURO',
    "slotUnits" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseArticle_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "WarehouseStorageUnit" ADD COLUMN IF NOT EXISTS "articleId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WarehouseArticle_organizationId_customerId_active_idx" ON "WarehouseArticle"("organizationId", "customerId", "active");
CREATE INDEX IF NOT EXISTS "WarehouseArticle_customerId_name_idx" ON "WarehouseArticle"("customerId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseArticle_customerId_articleNumber_key" ON "WarehouseArticle"("customerId", "articleNumber");
CREATE INDEX IF NOT EXISTS "WarehouseStorageUnit_articleId_idx" ON "WarehouseStorageUnit"("articleId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WarehouseArticle" ADD CONSTRAINT "WarehouseArticle_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WarehouseArticle" ADD CONSTRAINT "WarehouseArticle_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "WarehouseStorageUnit" ADD CONSTRAINT "WarehouseStorageUnit_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "WarehouseArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
