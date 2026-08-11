-- CreateTable
CREATE TABLE "EzollTourCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tourNumber" TEXT NOT NULL,
    "mrns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lrns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalItems" INTEGER,
    "sourceFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EzollTourCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EzollTourCache_lastSeenAt_idx" ON "EzollTourCache"("lastSeenAt");

-- CreateIndex
CREATE INDEX "EzollTourCache_organizationId_lastSeenAt_idx" ON "EzollTourCache"("organizationId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "EzollTourCache_organizationId_tourNumber_key" ON "EzollTourCache"("organizationId", "tourNumber");

-- AddForeignKey
ALTER TABLE "EzollTourCache" ADD CONSTRAINT "EzollTourCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
