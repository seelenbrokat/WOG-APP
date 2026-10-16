-- Soloplan StdTelematics Tours / Vehicles
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "soloplanVehicleId" TEXT NOT NULL,
    "number" TEXT,
    "matchcode" TEXT,
    "licensePlate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tour" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "soloplanTourId" TEXT NOT NULL,
    "tourNumber" TEXT NOT NULL,
    "lastAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "caption" TEXT,
    "infoText" TEXT,
    "targetStart" TIMESTAMP(3),
    "targetEnd" TIMESTAMP(3),
    "targetLoadKm" DOUBLE PRECISION,
    "driverName" TEXT,
    "driverFirstName" TEXT,
    "driverLastName" TEXT,
    "driverTelematicsId" TEXT,
    "vehicleId" TEXT,
    "dispatcherName" TEXT,
    "dispatcherEmail" TEXT,
    "dispatcherPhone" TEXT,
    "stopCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "lastSendDate" TIMESTAMP(3),
    "lastFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TourStop" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "soloplanTourStopId" TEXT,
    "sequence" INTEGER NOT NULL,
    "stopType" TEXT,
    "transportOrderNumber" TEXT,
    "name" TEXT,
    "street" TEXT,
    "zip" TEXT,
    "city" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "targetStart" TIMESTAMP(3),
    "targetEnd" TIMESTAMP(3),
    "activityDescription" TEXT,
    "phone" TEXT,

    CONSTRAINT "TourStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TourConsignment" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "soloplanOrderNumber" TEXT NOT NULL,
    "externalConsignmentNumber" TEXT,
    "senderName" TEXT,
    "senderBpNumber" TEXT,
    "receiverName" TEXT,

    CONSTRAINT "TourConsignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vehicle_organizationId_soloplanVehicleId_key" ON "Vehicle"("organizationId", "soloplanVehicleId");
CREATE INDEX "Vehicle_organizationId_licensePlate_idx" ON "Vehicle"("organizationId", "licensePlate");

CREATE UNIQUE INDEX "Tour_organizationId_soloplanTourId_key" ON "Tour"("organizationId", "soloplanTourId");
CREATE INDEX "Tour_organizationId_tourNumber_idx" ON "Tour"("organizationId", "tourNumber");
CREATE INDEX "Tour_organizationId_status_targetStart_idx" ON "Tour"("organizationId", "status", "targetStart");
CREATE INDEX "Tour_vehicleId_idx" ON "Tour"("vehicleId");

CREATE INDEX "TourStop_tourId_sequence_idx" ON "TourStop"("tourId", "sequence");
CREATE INDEX "TourStop_transportOrderNumber_idx" ON "TourStop"("transportOrderNumber");

CREATE INDEX "TourConsignment_tourId_idx" ON "TourConsignment"("tourId");
CREATE INDEX "TourConsignment_soloplanOrderNumber_idx" ON "TourConsignment"("soloplanOrderNumber");

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TourStop" ADD CONSTRAINT "TourStop_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TourConsignment" ADD CONSTRAINT "TourConsignment_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
