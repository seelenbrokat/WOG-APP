-- Org-weite Key/Value-Einstellungen (z. B. eZoll Dateiname-Ignore-Präfixe)

CREATE TABLE IF NOT EXISTS "OrganizationSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationSetting_organizationId_key_key"
  ON "OrganizationSetting"("organizationId", "key");

CREATE INDEX IF NOT EXISTS "OrganizationSetting_organizationId_idx"
  ON "OrganizationSetting"("organizationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationSetting_organizationId_fkey'
  ) THEN
    ALTER TABLE "OrganizationSetting"
      ADD CONSTRAINT "OrganizationSetting_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
