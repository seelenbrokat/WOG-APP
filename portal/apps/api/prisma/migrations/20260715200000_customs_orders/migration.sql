-- CreateTable
CREATE TABLE "CustomsOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mandantId" TEXT,
    "kennzeichen" TEXT NOT NULL,
    "grenzuebergang" TEXT NOT NULL,
    "zeit" TIMESTAMP(3) NOT NULL,
    "importeur" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomsOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomsOrder_customerId_createdAt_idx" ON "CustomsOrder"("customerId", "createdAt");
CREATE INDEX "CustomsOrder_organizationId_status_idx" ON "CustomsOrder"("organizationId", "status");

ALTER TABLE "CustomsOrder" ADD CONSTRAINT "CustomsOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsOrder" ADD CONSTRAINT "CustomsOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsOrder" ADD CONSTRAINT "CustomsOrder_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
