-- Speed up Intouch catalog lookups (worker scanned tens of thousands of processed files)
CREATE INDEX IF NOT EXISTS "IntouchFile_organizationId_storagePath_idx"
  ON "IntouchFile"("organizationId", "storagePath");
