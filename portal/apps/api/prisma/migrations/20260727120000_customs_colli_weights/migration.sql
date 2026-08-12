-- Collianzahl, Brutto- und Nettogewicht am Verzollungsauftrag
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "packageCount" INTEGER;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "weightKg" DOUBLE PRECISION;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "netWeightKg" DOUBLE PRECISION;
