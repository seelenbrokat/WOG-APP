-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'ENTLADEBERICHT';

-- AlterTable
ALTER TABLE "GoodsReceiptSession" ADD COLUMN IF NOT EXISTS "documentId" TEXT;
