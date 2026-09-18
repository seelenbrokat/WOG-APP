-- AlterTable Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "soloplanBusinessPartnerId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "matchcode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_organizationId_soloplanBusinessPartnerId_key"
  ON "Customer"("organizationId", "soloplanBusinessPartnerId");
CREATE INDEX IF NOT EXISTS "Customer_matchcode_idx" ON "Customer"("matchcode");

-- AlterTable Contact
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "soloplanContactNumber" INTEGER;

-- customerId optional (was required)
ALTER TABLE "Contact" ALTER COLUMN "customerId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "Contact_email_idx" ON "Contact"("email");
CREATE INDEX IF NOT EXISTS "Contact_customerId_idx" ON "Contact"("customerId");
CREATE INDEX IF NOT EXISTS "Contact_partnerId_idx" ON "Contact"("partnerId");

DO $$ BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Partner
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "soloplanBusinessPartnerId" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "matchcode" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "phone" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Partner_organizationId_soloplanBusinessPartnerId_key"
  ON "Partner"("organizationId", "soloplanBusinessPartnerId");
CREATE INDEX IF NOT EXISTS "Partner_matchcode_idx" ON "Partner"("matchcode");
