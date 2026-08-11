-- CreateTable
CREATE TABLE "LoadingUnitPosting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packagingTypeId" TEXT,
    "packagingMatchcode" TEXT NOT NULL,
    "packagingLabel" TEXT,
    "given" INTEGER NOT NULL DEFAULT 0,
    "taken" INTEGER NOT NULL DEFAULT 0,
    "balanceDelta" INTEGER NOT NULL DEFAULT 0,
    "tourId" TEXT,
    "tourNumber" TEXT,
    "tourStopId" TEXT,
    "tourStopExternalId" TEXT,
    "partnerNumber" TEXT,
    "partnerName" TEXT,
    "partnerCity" TEXT,
    "customerId" TEXT,
    "vehicleSoloplanId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "skipReason" TEXT,
    "occurredAt" TIMESTAMP(3),
    "sendDate" TIMESTAMP(3),
    "sourceFile" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadingUnitPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourStop_soloplanTourStopId_idx" ON "TourStop"("soloplanTourStopId");

-- CreateIndex
CREATE UNIQUE INDEX "LoadingUnitPosting_organizationId_sourceFile_packagingMatchcode_key" ON "LoadingUnitPosting"("organizationId", "sourceFile", "packagingMatchcode");

-- CreateIndex
CREATE INDEX "LoadingUnitPosting_organizationId_partnerName_packagingMatchcode_idx" ON "LoadingUnitPosting"("organizationId", "partnerName", "packagingMatchcode");

-- CreateIndex
CREATE INDEX "LoadingUnitPosting_organizationId_partnerNumber_packagingMatchcode_idx" ON "LoadingUnitPosting"("organizationId", "partnerNumber", "packagingMatchcode");

-- CreateIndex
CREATE INDEX "LoadingUnitPosting_organizationId_occurredAt_idx" ON "LoadingUnitPosting"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "LoadingUnitPosting_tourId_idx" ON "LoadingUnitPosting"("tourId");

-- CreateIndex
CREATE INDEX "LoadingUnitPosting_sourceFile_idx" ON "LoadingUnitPosting"("sourceFile");

-- AddForeignKey
ALTER TABLE "LoadingUnitPosting" ADD CONSTRAINT "LoadingUnitPosting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingUnitPosting" ADD CONSTRAINT "LoadingUnitPosting_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "PackagingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingUnitPosting" ADD CONSTRAINT "LoadingUnitPosting_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingUnitPosting" ADD CONSTRAINT "LoadingUnitPosting_tourStopId_fkey" FOREIGN KEY ("tourStopId") REFERENCES "TourStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
