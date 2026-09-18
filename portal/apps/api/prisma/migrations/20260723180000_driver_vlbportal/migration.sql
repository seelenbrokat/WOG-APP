-- AlterTable Vehicle: optional PIN from InTouch FAHRZEUGPIN
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "pin" TEXT;

-- CreateTable Driver (Soloplan/InTouch FAHRERID / Tour Driver1.TelematicsId)
CREATE TABLE IF NOT EXISTS "Driver" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandantId" TEXT,
    "telematicsId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "pin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastVehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Driver_organizationId_telematicsId_key"
  ON "Driver"("organizationId", "telematicsId");

CREATE INDEX IF NOT EXISTS "Driver_organizationId_lastName_idx"
  ON "Driver"("organizationId", "lastName");

CREATE INDEX IF NOT EXISTS "Driver_mandantId_idx" ON "Driver"("mandantId");

CREATE INDEX IF NOT EXISTS "Driver_lastVehicleId_idx" ON "Driver"("lastVehicleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Driver_organizationId_fkey'
  ) THEN
    ALTER TABLE "Driver"
      ADD CONSTRAINT "Driver_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Driver_mandantId_fkey'
  ) THEN
    ALTER TABLE "Driver"
      ADD CONSTRAINT "Driver_mandantId_fkey"
      FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Driver_lastVehicleId_fkey'
  ) THEN
    ALTER TABLE "Driver"
      ADD CONSTRAINT "Driver_lastVehicleId_fkey"
      FOREIGN KEY ("lastVehicleId") REFERENCES "Vehicle"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
