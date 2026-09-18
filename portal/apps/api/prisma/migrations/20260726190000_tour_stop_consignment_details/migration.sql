-- Zusätzliche Soloplan-Sendungs-/Stop-Details für Zustellapp (JSON)
ALTER TABLE "TourStop" ADD COLUMN IF NOT EXISTS "details" JSONB;
ALTER TABLE "TourConsignment" ADD COLUMN IF NOT EXISTS "details" JSONB;
