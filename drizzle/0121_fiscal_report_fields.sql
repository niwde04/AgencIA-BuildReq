SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "retentionDocumentDate" timestamp,
  ADD COLUMN IF NOT EXISTS "oceNumber" varchar(100),
  ADD COLUMN IF NOT EXISTS "oceExemptAmount15" numeric(14, 4),
  ADD COLUMN IF NOT EXISTS "oceExemptAmount18" numeric(14, 4),
  ADD COLUMN IF NOT EXISTS "dmcForeignSection" varchar(20),
  ADD COLUMN IF NOT EXISTS "dmcForeignIdentification" varchar(100),
  ADD COLUMN IF NOT EXISTS "dmcFyducaNumber" varchar(100),
  ADD COLUMN IF NOT EXISTS "dmcDuaNumber" varchar(100),
  ADD COLUMN IF NOT EXISTS "dmcImportOutsideCentralAmerica" boolean;

ALTER TABLE "invoiceItems"
  ADD COLUMN IF NOT EXISTS "dmcDestination" varchar(20);

UPDATE "invoices"
SET "retentionDocumentDate" = coalesce(
  "documentDate",
  "postingDate",
  "receiptDate"
)
WHERE
  "retentionDocumentDate" IS NULL
  AND (
    nullif(btrim(coalesce("retentionReceiptNumber", '')), '') IS NOT NULL
    OR "retentionTotal" > 0
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_dmc_foreign_section_check'
      AND conrelid = '"invoices"'::regclass
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoice_dmc_foreign_section_check"
      CHECK (
        "dmcForeignSection" IS NULL
        OR "dmcForeignSection" IN ('fyduca', 'importacion')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_oce_split_amounts_check'
      AND conrelid = '"invoices"'::regclass
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoice_oce_split_amounts_check"
      CHECK (
        ("oceExemptAmount15" IS NULL OR "oceExemptAmount15" >= 0)
        AND
        ("oceExemptAmount18" IS NULL OR "oceExemptAmount18" >= 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_item_dmc_destination_check'
      AND conrelid = '"invoiceItems"'::regclass
  ) THEN
    ALTER TABLE "invoiceItems"
      ADD CONSTRAINT "invoice_item_dmc_destination_check"
      CHECK (
        "dmcDestination" IS NULL
        OR "dmcDestination" IN ('costo', 'gasto', 'no_deducible')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoice_retention_document_date_idx"
  ON "invoices" ("retentionDocumentDate")
  WHERE "retentionDocumentDate" IS NOT NULL;
