-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CUSTOMS_PAPER';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "customsOrderId" TEXT;

CREATE INDEX IF NOT EXISTS "Document_customsOrderId_idx" ON "Document"("customsOrderId");

DO $$ BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_customsOrderId_fkey"
    FOREIGN KEY ("customsOrderId") REFERENCES "CustomsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
