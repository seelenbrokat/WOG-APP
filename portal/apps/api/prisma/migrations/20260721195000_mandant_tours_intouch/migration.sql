-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "mandantId" TEXT;

-- AlterTable
ALTER TABLE "Tour" ADD COLUMN "mandantId" TEXT;

-- CreateTable
CREATE TABLE "IntouchFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntouchFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_mandantId_idx" ON "Vehicle"("mandantId");
CREATE INDEX "Tour_mandantId_status_idx" ON "Tour"("mandantId", "status");
CREATE INDEX "IntouchFile_organizationId_channel_createdAt_idx" ON "IntouchFile"("organizationId", "channel", "createdAt");
CREATE INDEX "IntouchFile_status_idx" ON "IntouchFile"("status");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IntouchFile" ADD CONSTRAINT "IntouchFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Org/Mandant-Namen: AG = WOG Logistics AG, GmbH ausblenden
UPDATE "Organization" SET name = 'WOG Logistics AG' WHERE slug = 'wog';
UPDATE "Mandant" SET name = 'WOG Logistics AG', "legalName" = 'WOG Logistics AG', active = true WHERE code = 'AG';
UPDATE "Mandant" SET name = 'WOG GmbH', "legalName" = 'WOG GmbH', active = false WHERE code = 'GMBH';

-- Bestehende Touren/Fahrzeuge dem aktiven AG-Mandanten zuordnen
UPDATE "Tour" t
SET "mandantId" = m.id
FROM "Mandant" m
WHERE m.code = 'AG'
  AND m."organizationId" = t."organizationId"
  AND t."mandantId" IS NULL;

UPDATE "Vehicle" v
SET "mandantId" = m.id
FROM "Mandant" m
WHERE m.code = 'AG'
  AND m."organizationId" = v."organizationId"
  AND v."mandantId" IS NULL;
