-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'LOADING_LIST';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "transportOrderId" TEXT;

-- CreateIndex
CREATE INDEX "Document_transportOrderId_idx" ON "Document"("transportOrderId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_transportOrderId_fkey" FOREIGN KEY ("transportOrderId") REFERENCES "TransportOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
