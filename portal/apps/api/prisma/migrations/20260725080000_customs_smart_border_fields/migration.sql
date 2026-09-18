-- Smart Border Austria: Kennzeichen Anhänger, Zulassungsland, Grenzzollstelle
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "zulassungsland" TEXT NOT NULL DEFAULT 'AT';
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "kennzeichenAnhaenger" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "zulassungslandAnhaenger" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "grenzzollstelle" TEXT;
