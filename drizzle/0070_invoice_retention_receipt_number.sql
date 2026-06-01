ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "retentionReceiptNumber" varchar(100);
