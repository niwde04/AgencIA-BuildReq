ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "cai" varchar(100),
  ADD COLUMN IF NOT EXISTS "invoiceNumber" varchar(100),
  ADD COLUMN IF NOT EXISTS "documentDate" timestamp,
  ADD COLUMN IF NOT EXISTS "postingDate" timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "receiptDate" timestamp DEFAULT now();

UPDATE "receipts"
SET
  "postingDate" = COALESCE("postingDate", "createdAt"),
  "receiptDate" = COALESCE("receiptDate", "createdAt")
WHERE "postingDate" IS NULL
   OR "receiptDate" IS NULL;

ALTER TABLE "receipts"
  ALTER COLUMN "postingDate" SET NOT NULL,
  ALTER COLUMN "receiptDate" SET NOT NULL;
