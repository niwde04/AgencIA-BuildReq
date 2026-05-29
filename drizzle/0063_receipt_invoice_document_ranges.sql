ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "documentRangeStart" varchar(100),
  ADD COLUMN IF NOT EXISTS "documentRangeEnd" varchar(100);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "documentRangeStart" varchar(100),
  ADD COLUMN IF NOT EXISTS "documentRangeEnd" varchar(100);
