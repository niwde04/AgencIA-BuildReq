ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "retentionCai" varchar(100),
  ADD COLUMN IF NOT EXISTS "retentionDocumentRangeStart" varchar(100),
  ADD COLUMN IF NOT EXISTS "retentionDocumentRangeEnd" varchar(100),
  ADD COLUMN IF NOT EXISTS "retentionEmissionDeadline" timestamp;
