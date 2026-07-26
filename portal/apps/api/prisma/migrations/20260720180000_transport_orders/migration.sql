-- CreateTable
CREATE TABLE "TransportOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandantId" TEXT NOT NULL,
    "freightPayerCustomerId" TEXT NOT NULL,
    "externalNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "soloplanRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportOrder_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "orderId" TEXT;

-- CreateIndex
CREATE INDEX "TransportOrder_freightPayerCustomerId_idx" ON "TransportOrder"("freightPayerCustomerId");

-- CreateIndex
CREATE INDEX "TransportOrder_mandantId_idx" ON "TransportOrder"("mandantId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportOrder_organizationId_externalNumber_key" ON "TransportOrder"("organizationId", "externalNumber");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- AddForeignKey
ALTER TABLE "TransportOrder" ADD CONSTRAINT "TransportOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportOrder" ADD CONSTRAINT "TransportOrder_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportOrder" ADD CONSTRAINT "TransportOrder_freightPayerCustomerId_fkey" FOREIGN KEY ("freightPayerCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TransportOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
