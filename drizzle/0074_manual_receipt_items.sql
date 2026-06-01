ALTER TABLE "receiptItems"
  ALTER COLUMN "sourceItemId" DROP NOT NULL;

ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "sapItemCode" varchar(50);

CREATE INDEX IF NOT EXISTS "reci_sap_item_idx"
  ON "receiptItems" ("sapItemCode");

ALTER TABLE "invoiceItems"
  ALTER COLUMN "purchaseOrderItemId" DROP NOT NULL;
