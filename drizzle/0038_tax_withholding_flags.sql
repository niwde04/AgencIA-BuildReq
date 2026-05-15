ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "allowsTaxWithholding" boolean DEFAULT true NOT NULL;

ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "allowsTaxWithholding" boolean DEFAULT true NOT NULL;

ALTER TABLE "invoiceItems"
ADD COLUMN IF NOT EXISTS "allowsTaxWithholding" boolean DEFAULT true NOT NULL;

UPDATE "suppliers"
SET "allowsTaxWithholding" = true
WHERE "allowsTaxWithholding" IS DISTINCT FROM true;

UPDATE "sapCatalog"
SET "allowsTaxWithholding" = true
WHERE "allowsTaxWithholding" IS DISTINCT FROM true;

UPDATE "invoiceItems" invoice_item
SET "allowsTaxWithholding" = COALESCE(catalog."allowsTaxWithholding", true)
FROM "sapCatalog" catalog
WHERE catalog."itemCode" = COALESCE(
  NULLIF(invoice_item."currentSapItemCode", ''),
  NULLIF(invoice_item."originalSapItemCode", '')
);

UPDATE "invoiceItems"
SET "allowsTaxWithholding" = true
WHERE "allowsTaxWithholding" IS NULL;
