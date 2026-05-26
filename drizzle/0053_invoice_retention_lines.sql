ALTER TABLE "invoiceRetentions"
ADD COLUMN IF NOT EXISTS "invoiceItemId" integer
REFERENCES "invoiceItems"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "invr_invoice_item_idx"
  ON "invoiceRetentions" ("invoiceItemId");
