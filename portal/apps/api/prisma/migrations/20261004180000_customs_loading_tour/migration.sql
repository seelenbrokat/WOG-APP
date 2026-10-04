-- Selbstfahrer-Beladung (ERVO u. a.): Tour + deferred vehicle flags
CREATE TABLE "CustomsLoadingTour" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kennzeichen" TEXT NOT NULL,
    "zulassungsland" TEXT NOT NULL DEFAULT 'AT',
    "kennzeichenAnhaenger" TEXT,
    "zulassungslandAnhaenger" TEXT,
    "grenzuebergang" TEXT NOT NULL,
    "zeit" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RELEASED',
    "loadingListDocumentId" TEXT,
    "avisoSentAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsLoadingTour_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomsLoadingTour_organizationId_createdAt_idx" ON "CustomsLoadingTour"("organizationId", "createdAt");
CREATE INDEX "CustomsLoadingTour_customerId_createdAt_idx" ON "CustomsLoadingTour"("customerId", "createdAt");

ALTER TABLE "CustomsLoadingTour" ADD CONSTRAINT "CustomsLoadingTour_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsLoadingTour" ADD CONSTRAINT "CustomsLoadingTour_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomsOrder" ADD COLUMN "vehicleDeferred" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomsOrder" ADD COLUMN "loadingTourId" TEXT;

CREATE INDEX "CustomsOrder_loadingTourId_idx" ON "CustomsOrder"("loadingTourId");
CREATE INDEX "CustomsOrder_customerId_vehicleDeferred_loadingTourId_idx" ON "CustomsOrder"("customerId", "vehicleDeferred", "loadingTourId");

ALTER TABLE "CustomsOrder" ADD CONSTRAINT "CustomsOrder_loadingTourId_fkey" FOREIGN KEY ("loadingTourId") REFERENCES "CustomsLoadingTour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
