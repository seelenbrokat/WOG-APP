-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER', 'PARTNER');
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED');
CREATE TYPE "DocumentType" AS ENUM ('POD', 'ABLIEFERBELEG', 'CMR', 'INVOICE', 'CUSTOMER_UPLOAD', 'PARTNER_FILE', 'OTHER');
CREATE TYPE "NotificationEvent" AS ENUM ('SHIPMENT_CREATED', 'STATUS_CHANGED', 'POD_AVAILABLE', 'DOCUMENT_RECEIVED', 'PARTNER_FILE_IMPORTED');
CREATE TYPE "PartnerJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Mandant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Mandant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "vatId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "mandantId" TEXT,
    "label" TEXT,
    "company" TEXT,
    "street" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'AT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "verifyToken" TEXT,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserMandantAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mandantId" TEXT NOT NULL,
    CONSTRAINT "UserMandantAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "trackingPin" TEXT,
    "reference" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "transportMode" TEXT,
    "goodsDescription" TEXT,
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DOUBLE PRECISION,
    "volumeM3" DOUBLE PRECISION,
    "pickupCompany" TEXT,
    "pickupStreet" TEXT,
    "pickupZip" TEXT,
    "pickupCity" TEXT,
    "pickupCountry" TEXT DEFAULT 'AT',
    "pickupDate" TIMESTAMP(3),
    "deliveryCompany" TEXT,
    "deliveryStreet" TEXT,
    "deliveryZip" TEXT,
    "deliveryCity" TEXT,
    "deliveryCountry" TEXT DEFAULT 'AT',
    "deliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "soloplanRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DOUBLE PRECISION,
    "lengthCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "sscc" TEXT,
    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "message" TEXT,
    "location" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "type" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "event" "NotificationEvent",
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "sftpUsername" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerJob" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "PartnerJobStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Mandant_organizationId_code_key" ON "Mandant"("organizationId", "code");
CREATE UNIQUE INDEX "Customer_organizationId_customerNumber_key" ON "Customer"("organizationId", "customerNumber");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "UserMandantAccess_userId_mandantId_key" ON "UserMandantAccess"("userId", "mandantId");
CREATE UNIQUE INDEX "Shipment_trackingNumber_key" ON "Shipment"("trackingNumber");
CREATE INDEX "Shipment_mandantId_status_idx" ON "Shipment"("mandantId", "status");
CREATE INDEX "Shipment_customerId_idx" ON "Shipment"("customerId");
CREATE INDEX "Shipment_organizationId_idx" ON "Shipment"("organizationId");
CREATE INDEX "StatusEvent_shipmentId_createdAt_idx" ON "StatusEvent"("shipmentId", "createdAt");
CREATE INDEX "Document_shipmentId_idx" ON "Document"("shipmentId");
CREATE INDEX "Document_customerId_idx" ON "Document"("customerId");
CREATE UNIQUE INDEX "NotificationPreference_userId_event_key" ON "NotificationPreference"("userId", "event");
CREATE UNIQUE INDEX "Partner_userId_key" ON "Partner"("userId");
CREATE UNIQUE INDEX "Partner_organizationId_code_key" ON "Partner"("organizationId", "code");
CREATE INDEX "PartnerJob_status_createdAt_idx" ON "PartnerJob"("status", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

ALTER TABLE "Mandant" ADD CONSTRAINT "Mandant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Address" ADD CONSTRAINT "Address_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserMandantAccess" ADD CONSTRAINT "UserMandantAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMandantAccess" ADD CONSTRAINT "UserMandantAccess_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "Mandant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerJob" ADD CONSTRAINT "PartnerJob_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
