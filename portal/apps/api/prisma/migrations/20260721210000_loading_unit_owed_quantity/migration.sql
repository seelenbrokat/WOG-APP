-- Anzahl schuldender Lademittel (z. B. bei Nicht-Tausch aus Sendungsmenge)
ALTER TABLE "LoadingUnitPosting" ADD COLUMN "owedQuantity" INTEGER NOT NULL DEFAULT 0;
