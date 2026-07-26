-- ZAZ-Konto und Warenort/Verzollungsort für Verzollungsauftrag (Soloplan VLBPortal)
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "zazKonto" TEXT;
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "warenort" TEXT;
