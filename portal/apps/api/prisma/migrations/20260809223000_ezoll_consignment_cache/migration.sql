-- CreateTable
CREATE TABLE "EzollConsignmentCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "consignmentIndex" INTEGER NOT NULL DEFAULT 1,
    "cc529SeenAt" TIMESTAMP(3),
    "cc599SeenAt" TIMESTAMP(3),
    "mrn" TEXT,
    "lrn" TEXT,
    "totalItems" INTEGER,
    "eur1Number" TEXT,
    "sourceFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EzollConsignmentCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EzollConsignmentCache_lastSeenAt_idx" ON "EzollConsignmentCache"("lastSeenAt");

-- CreateIndex
CREATE INDEX "EzollConsignmentCache_organizationId_lastSeenAt_idx" ON "EzollConsignmentCache"("organizationId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "EzollConsignmentCache_organizationId_orderNumber_consignmentIndex_key" ON "EzollConsignmentCache"("organizationId", "orderNumber", "consignmentIndex");

-- AddForeignKey
ALTER TABLE "EzollConsignmentCache" ADD CONSTRAINT "EzollConsignmentCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
