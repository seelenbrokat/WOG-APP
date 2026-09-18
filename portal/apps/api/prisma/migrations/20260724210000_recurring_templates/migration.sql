-- AlterTable
ALTER TABLE "ShipmentTemplate" ADD COLUMN IF NOT EXISTS "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShipmentTemplate" ADD COLUMN IF NOT EXISTS "scheduleFreq" TEXT;
ALTER TABLE "ShipmentTemplate" ADD COLUMN IF NOT EXISTS "scheduleWeekdays" TEXT;
ALTER TABLE "ShipmentTemplate" ADD COLUMN IF NOT EXISTS "scheduleNextRun" TIMESTAMP(3);
ALTER TABLE "ShipmentTemplate" ADD COLUMN IF NOT EXISTS "scheduleLastRun" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ShipmentTemplate_scheduleEnabled_scheduleNextRun_idx"
  ON "ShipmentTemplate"("scheduleEnabled", "scheduleNextRun");
