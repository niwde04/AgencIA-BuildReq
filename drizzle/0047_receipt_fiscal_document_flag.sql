ALTER TABLE "receipts"
ADD COLUMN IF NOT EXISTS "isFiscalDocument" boolean DEFAULT false NOT NULL;

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "isFiscalDocument" boolean DEFAULT false NOT NULL;

UPDATE "receipts"
SET
  "isFiscalDocument" = true,
  "updatedAt" = now()
WHERE "sourceType" = 'purchase_order';

UPDATE "invoices"
SET
  "isFiscalDocument" = true,
  "updatedAt" = now();
