-- AlterTable
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "driverPhone" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "smartborderNotifyEmail" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "smartborderSendSms" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "smartborderToken" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "smartborderUrl" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "smartborderLinkedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomsOrder_organizationId_kennzeichen_idx" ON "CustomsOrder"("organizationId", "kennzeichen");
