-- CreateEnum
CREATE TYPE "CustomerDocCategory" AS ENUM ('INVOICE', 'CUSTOMS_EXIT', 'POD', 'CMR', 'OTHER');

-- AlterTable Customer
ALTER TABLE "Customer" ADD COLUMN "documentsModuleEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Document
ALTER TABLE "Document" ADD COLUMN "categoryCode" "CustomerDocCategory";
ALTER TABLE "Document" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'UPLOAD';
ALTER TABLE "Document" ADD COLUMN "sourceFileName" TEXT;
ALTER TABLE "Document" ADD COLUMN "importedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CustomerDocumentCategoryAccess" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "category" "CustomerDocCategory" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDocumentCategoryAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDownload" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT,
    "customerId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocumentCategoryAccess_customerId_category_key" ON "CustomerDocumentCategoryAccess"("customerId", "category");
CREATE INDEX "CustomerDocumentCategoryAccess_customerId_active_idx" ON "CustomerDocumentCategoryAccess"("customerId", "active");
CREATE UNIQUE INDEX "DocumentDownload_documentId_userId_key" ON "DocumentDownload"("documentId", "userId");
CREATE INDEX "DocumentDownload_customerId_downloadedAt_idx" ON "DocumentDownload"("customerId", "downloadedAt");
CREATE INDEX "DocumentDownload_documentId_idx" ON "DocumentDownload"("documentId");
CREATE INDEX "Document_organizationId_categoryCode_idx" ON "Document"("organizationId", "categoryCode");
CREATE INDEX "Document_customerId_categoryCode_idx" ON "Document"("customerId", "categoryCode");

-- AddForeignKey
ALTER TABLE "CustomerDocumentCategoryAccess" ADD CONSTRAINT "CustomerDocumentCategoryAccess_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentDownload" ADD CONSTRAINT "DocumentDownload_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentDownload" ADD CONSTRAINT "DocumentDownload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentDownload" ADD CONSTRAINT "DocumentDownload_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
