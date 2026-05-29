ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "isFixedAsset" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "isLeasing" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "assetDetails" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "invoiceItems"
  ADD COLUMN IF NOT EXISTS "isFixedAsset" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "isLeasing" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "assetDetails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "lineObservation" text;

UPDATE "invoiceItems" invoice_item
SET "lineObservation" = receipt_item."notes"
FROM "receiptItems" receipt_item
WHERE invoice_item."receiptItemId" = receipt_item."id"
  AND invoice_item."lineObservation" IS NULL
  AND receipt_item."notes" IS NOT NULL;
