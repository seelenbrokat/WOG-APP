-- Live-ETA von Zustellapp für Dispo + Endkunde
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "etaAt" TIMESTAMP(3);
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "etaText" TEXT;
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "etaUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "etaSource" TEXT;

CREATE INDEX IF NOT EXISTS "Tour_organizationId_etaAt_idx" ON "Tour"("organizationId", "etaAt");
