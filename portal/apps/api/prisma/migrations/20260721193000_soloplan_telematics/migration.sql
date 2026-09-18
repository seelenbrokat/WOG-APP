-- AlterTable Vehicle
ALTER TABLE "Vehicle" ADD COLUMN "lastLatitude" DOUBLE PRECISION;
ALTER TABLE "Vehicle" ADD COLUMN "lastLongitude" DOUBLE PRECISION;
ALTER TABLE "Vehicle" ADD COLUMN "lastLocationAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "lastDriverId" TEXT;

-- AlterTable Tour
ALTER TABLE "Tour" ADD COLUMN "telematicsStatus" TEXT;
ALTER TABLE "Tour" ADD COLUMN "lastStatusAt" TIMESTAMP(3);
ALTER TABLE "Tour" ADD COLUMN "lastLatitude" DOUBLE PRECISION;
ALTER TABLE "Tour" ADD COLUMN "lastLongitude" DOUBLE PRECISION;

-- AlterTable TourConsignment
ALTER TABLE "TourConsignment" ADD COLUMN "status" TEXT;
ALTER TABLE "TourConsignment" ADD COLUMN "statusText" TEXT;
ALTER TABLE "TourConsignment" ADD COLUMN "lastStatusAt" TIMESTAMP(3);
ALTER TABLE "TourConsignment" ADD COLUMN "lastLatitude" DOUBLE PRECISION;
ALTER TABLE "TourConsignment" ADD COLUMN "lastLongitude" DOUBLE PRECISION;

-- CreateTable TelematicsEvent
CREATE TABLE "TelematicsEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "vehicleId" TEXT,
    "tourId" TEXT,
    "tourNumber" TEXT,
    "transportOrderNumber" TEXT,
    "status" TEXT,
    "statusText" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "eventAt" TIMESTAMP(3),
    "sendDate" TIMESTAMP(3),
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelematicsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable TourDocument
CREATE TABLE "TourDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tourId" TEXT,
    "tourNumber" TEXT,
    "transportOrderNumber" TEXT,
    "vehicleSoloplanId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TourDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Vehicle_organizationId_lastLocationAt_idx" ON "Vehicle"("organizationId", "lastLocationAt");

CREATE INDEX "TelematicsEvent_organizationId_eventAt_idx" ON "TelematicsEvent"("organizationId", "eventAt");
CREATE INDEX "TelematicsEvent_tourId_eventAt_idx" ON "TelematicsEvent"("tourId", "eventAt");
CREATE INDEX "TelematicsEvent_vehicleId_eventAt_idx" ON "TelematicsEvent"("vehicleId", "eventAt");
CREATE INDEX "TelematicsEvent_transportOrderNumber_idx" ON "TelematicsEvent"("transportOrderNumber");
CREATE INDEX "TelematicsEvent_sourceFile_idx" ON "TelematicsEvent"("sourceFile");

CREATE INDEX "TourDocument_organizationId_createdAt_idx" ON "TourDocument"("organizationId", "createdAt");
CREATE INDEX "TourDocument_tourId_idx" ON "TourDocument"("tourId");
CREATE INDEX "TourDocument_transportOrderNumber_idx" ON "TourDocument"("transportOrderNumber");
CREATE INDEX "TourDocument_sourceFile_idx" ON "TourDocument"("sourceFile");

ALTER TABLE "TelematicsEvent" ADD CONSTRAINT "TelematicsEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelematicsEvent" ADD CONSTRAINT "TelematicsEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelematicsEvent" ADD CONSTRAINT "TelematicsEvent_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TourDocument" ADD CONSTRAINT "TourDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TourDocument" ADD CONSTRAINT "TourDocument_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
