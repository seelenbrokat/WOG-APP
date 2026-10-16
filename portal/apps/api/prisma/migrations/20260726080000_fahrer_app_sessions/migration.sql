-- Fahrer-Zustellapp: Geräte-Sessions, QR-Login, Chat-Relay

CREATE TABLE IF NOT EXISTS "DriverDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverDevice_refreshTokenHash_key"
  ON "DriverDevice"("refreshTokenHash");
CREATE INDEX IF NOT EXISTS "DriverDevice_organizationId_driverId_idx"
  ON "DriverDevice"("organizationId", "driverId");
CREATE INDEX IF NOT EXISTS "DriverDevice_expiresAt_idx"
  ON "DriverDevice"("expiresAt");

CREATE TABLE IF NOT EXISTS "DriverQrToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverQrToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverQrToken_tokenHash_key"
  ON "DriverQrToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "DriverQrToken_organizationId_expiresAt_idx"
  ON "DriverQrToken"("organizationId", "expiresAt");

CREATE TABLE IF NOT EXISTS "DriverChatMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "driverTelematicsId" TEXT,
    "tourNumber" TEXT,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "soloplanRef" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DriverChatMessage_organizationId_createdAt_idx"
  ON "DriverChatMessage"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "DriverChatMessage_vehicleId_createdAt_idx"
  ON "DriverChatMessage"("vehicleId", "createdAt");
CREATE INDEX IF NOT EXISTS "DriverChatMessage_driverTelematicsId_createdAt_idx"
  ON "DriverChatMessage"("driverTelematicsId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverDevice_organizationId_fkey') THEN
    ALTER TABLE "DriverDevice"
      ADD CONSTRAINT "DriverDevice_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverDevice_driverId_fkey') THEN
    ALTER TABLE "DriverDevice"
      ADD CONSTRAINT "DriverDevice_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverDevice_vehicleId_fkey') THEN
    ALTER TABLE "DriverDevice"
      ADD CONSTRAINT "DriverDevice_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverQrToken_organizationId_fkey') THEN
    ALTER TABLE "DriverQrToken"
      ADD CONSTRAINT "DriverQrToken_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverQrToken_vehicleId_fkey') THEN
    ALTER TABLE "DriverQrToken"
      ADD CONSTRAINT "DriverQrToken_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverQrToken_driverId_fkey') THEN
    ALTER TABLE "DriverQrToken"
      ADD CONSTRAINT "DriverQrToken_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverChatMessage_organizationId_fkey') THEN
    ALTER TABLE "DriverChatMessage"
      ADD CONSTRAINT "DriverChatMessage_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverChatMessage_vehicleId_fkey') THEN
    ALTER TABLE "DriverChatMessage"
      ADD CONSTRAINT "DriverChatMessage_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverChatMessage_driverId_fkey') THEN
    ALTER TABLE "DriverChatMessage"
      ADD CONSTRAINT "DriverChatMessage_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
