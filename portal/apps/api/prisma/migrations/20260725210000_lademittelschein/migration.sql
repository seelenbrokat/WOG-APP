-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'LADEMITTELSCHEIN';

-- CreateTable
CREATE TABLE IF NOT EXISTS "Lademittelschein" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandantId" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "companyEntity" TEXT NOT NULL DEFAULT 'AG',
    "tourId" TEXT,
    "tourNumber" TEXT,
    "partnerId" TEXT,
    "partnerName" TEXT,
    "partnerNumber" TEXT,
    "partnerEmail" TEXT,
    "vehiclePlate" TEXT,
    "driverName" TEXT,
    "reference" TEXT,
    "locationText" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eupOut" INTEGER NOT NULL DEFAULT 0,
    "rahmenOut" INTEGER NOT NULL DEFAULT 0,
    "deckelOut" INTEGER NOT NULL DEFAULT 0,
    "gitterboxOut" INTEGER NOT NULL DEFAULT 0,
    "otherOut" TEXT,
    "eupIn" INTEGER NOT NULL DEFAULT 0,
    "rahmenIn" INTEGER NOT NULL DEFAULT 0,
    "deckelIn" INTEGER NOT NULL DEFAULT 0,
    "gitterboxIn" INTEGER NOT NULL DEFAULT 0,
    "otherIn" TEXT,
    "noExchangeNoStock" BOOLEAN NOT NULL DEFAULT false,
    "noExchangeDriverRefuse" BOOLEAN NOT NULL DEFAULT false,
    "wogSignedByName" TEXT,
    "wogSignaturePath" TEXT,
    "partnerSignedByName" TEXT,
    "partnerSignaturePath" TEXT,
    "documentId" TEXT,
    "emailedAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "exportPath" TEXT,
    "sourceFile" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lademittelschein_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Lademittelschein_organizationId_number_key"
  ON "Lademittelschein"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "Lademittelschein_organizationId_occurredAt_idx"
  ON "Lademittelschein"("organizationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Lademittelschein_organizationId_status_idx"
  ON "Lademittelschein"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Lademittelschein_tourNumber_idx"
  ON "Lademittelschein"("tourNumber");
CREATE INDEX IF NOT EXISTS "Lademittelschein_partnerId_idx"
  ON "Lademittelschein"("partnerId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lademittelschein_organizationId_fkey'
  ) THEN
    ALTER TABLE "Lademittelschein"
      ADD CONSTRAINT "Lademittelschein_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lademittelschein_tourId_fkey'
  ) THEN
    ALTER TABLE "Lademittelschein"
      ADD CONSTRAINT "Lademittelschein_tourId_fkey"
      FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lademittelschein_partnerId_fkey'
  ) THEN
    ALTER TABLE "Lademittelschein"
      ADD CONSTRAINT "Lademittelschein_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
