-- CreateEnum
CREATE TYPE "IntegrationSystem" AS ENUM ('SOLOPLAN', 'LDV', 'MERCURIO');
CREATE TYPE "IntegrationTransferStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "IntegrationTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromSystem" "IntegrationSystem" NOT NULL,
    "toSystem" "IntegrationSystem" NOT NULL,
    "status" "IntegrationTransferStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "customsOrderId" TEXT,
    "shipmentId" TEXT,
    "payload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "fileName" TEXT,
    "message" TEXT,
    "createdById" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationTransfer_organizationId_createdAt_idx" ON "IntegrationTransfer"("organizationId", "createdAt");
CREATE INDEX "IntegrationTransfer_status_createdAt_idx" ON "IntegrationTransfer"("status", "createdAt");
CREATE INDEX "IntegrationTransfer_fromSystem_toSystem_idx" ON "IntegrationTransfer"("fromSystem", "toSystem");
