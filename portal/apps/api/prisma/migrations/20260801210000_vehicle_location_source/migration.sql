-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "lastLocationSource" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Vehicle_organizationId_lastLocationSource_idx" ON "Vehicle"("organizationId", "lastLocationSource");
