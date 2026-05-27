ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "documentDueDate" timestamp;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "documentDueDate" timestamp;
