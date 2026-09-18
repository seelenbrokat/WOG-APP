-- Foto-Verknüpfung pro Colli-Check (Abweichung WE TC57)
ALTER TABLE "GoodsReceiptColloCheck" ADD COLUMN IF NOT EXISTS "documentId" TEXT;
