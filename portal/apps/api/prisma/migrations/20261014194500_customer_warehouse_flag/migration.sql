-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "warehouseCustomer" BOOLEAN NOT NULL DEFAULT false;
