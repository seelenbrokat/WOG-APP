-- SFTP-Inbound für Kunden-/Partner-Auftragsdateien (z. B. Quehenberger FORTRAS BORD512)
-- Freischaltung nur durch Admin (sftpInboundEnabled), nicht pauschal.

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "sftpInboundEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sftpUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "sftpInboundFormat" TEXT DEFAULT 'BORD512';

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "sftpInboundEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sftpInboundFormat" TEXT DEFAULT 'BORD512';

CREATE INDEX IF NOT EXISTS "Customer_sftpUsername_idx" ON "Customer"("sftpUsername");
CREATE INDEX IF NOT EXISTS "Partner_sftpUsername_idx" ON "Partner"("sftpUsername");
