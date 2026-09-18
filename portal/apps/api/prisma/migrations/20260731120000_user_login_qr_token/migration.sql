-- Lager-/Portal-Login per QR-Code (Station-Badge für Tablets)

CREATE TABLE IF NOT EXISTS "UserLoginQrToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "redirectPath" TEXT NOT NULL DEFAULT '/scanning/we-tc57',
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserLoginQrToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserLoginQrToken_tokenHash_key"
  ON "UserLoginQrToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "UserLoginQrToken_organizationId_expiresAt_idx"
  ON "UserLoginQrToken"("organizationId", "expiresAt");
CREATE INDEX IF NOT EXISTS "UserLoginQrToken_userId_revokedAt_idx"
  ON "UserLoginQrToken"("userId", "revokedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserLoginQrToken_organizationId_fkey') THEN
    ALTER TABLE "UserLoginQrToken"
      ADD CONSTRAINT "UserLoginQrToken_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserLoginQrToken_userId_fkey') THEN
    ALTER TABLE "UserLoginQrToken"
      ADD CONSTRAINT "UserLoginQrToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
