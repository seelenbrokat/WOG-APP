-- Wareninhalt / Inhaltsbeschreibung am Verzollungsauftrag
ALTER TABLE "CustomsOrder" ADD COLUMN IF NOT EXISTS "goodsDescription" TEXT;
