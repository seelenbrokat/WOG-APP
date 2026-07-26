-- Soloplan „LM-Buchungen erzeugen“ (Ja/Nein) → nur Ja wird gebucht
ALTER TABLE "PackagingType" ADD COLUMN "createBookings" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "PackagingType_organizationId_createBookings_idx" ON "PackagingType"("organizationId", "createBookings");

-- Bekannte Nicht-Buchungs-Typen (Screenshot + bisherige Hardcodes) vor CSV-Reimport
UPDATE "PackagingType"
SET "createBookings" = false
WHERE UPPER("matchcode") IN ('DIV', 'GL', 'CR', 'EWP', 'HP', 'EINWEGPALE');
