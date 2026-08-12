-- Soloplan GP-Export: Verpackungen + Dokumentenkategorien
CREATE TABLE "PackagingType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "soloplanNumber" INTEGER NOT NULL,
    "matchcode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT,
    "article" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "soloplanNumber" INTEGER NOT NULL,
    "matchcode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackagingType_organizationId_soloplanNumber_key" ON "PackagingType"("organizationId", "soloplanNumber");
CREATE INDEX "PackagingType_organizationId_matchcode_idx" ON "PackagingType"("organizationId", "matchcode");

CREATE UNIQUE INDEX "DocumentCategory_organizationId_soloplanNumber_key" ON "DocumentCategory"("organizationId", "soloplanNumber");
CREATE INDEX "DocumentCategory_organizationId_matchcode_idx" ON "DocumentCategory"("organizationId", "matchcode");

ALTER TABLE "PackagingType" ADD CONSTRAINT "PackagingType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCategory" ADD CONSTRAINT "DocumentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
