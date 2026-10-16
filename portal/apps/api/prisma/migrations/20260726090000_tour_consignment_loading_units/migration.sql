-- Lademittel je Tour-Sendung (bereits auf Prod vorhanden – idempotent)
ALTER TABLE "TourConsignment" ADD COLUMN IF NOT EXISTS "loadingUnits" JSONB;
