CREATE TABLE IF NOT EXISTS "supplierFiscalDocumentRanges" (
  "id" serial PRIMARY KEY,
  "supplierId" integer REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "supplierRtn" varchar(50) NOT NULL,
  "supplierRtnNormalized" varchar(50) NOT NULL,
  "cai" varchar(100) NOT NULL,
  "documentRangeStart" varchar(100) NOT NULL,
  "documentRangeEnd" varchar(100) NOT NULL,
  "documentRangeStartKey" varchar(32) NOT NULL,
  "documentRangeEndKey" varchar(32) NOT NULL,
  "emissionDeadline" timestamp NOT NULL,
  "sourceInvoiceId" integer REFERENCES "invoices"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sup_fiscal_range_supplier_idx"
ON "supplierFiscalDocumentRanges" ("supplierId");

CREATE INDEX IF NOT EXISTS "sup_fiscal_range_lookup_idx"
ON "supplierFiscalDocumentRanges" (
  "supplierRtnNormalized",
  "documentRangeStartKey",
  "documentRangeEndKey"
);

CREATE INDEX IF NOT EXISTS "sup_fiscal_range_source_invoice_idx"
ON "supplierFiscalDocumentRanges" ("sourceInvoiceId");

CREATE UNIQUE INDEX IF NOT EXISTS "sup_fiscal_range_unique_idx"
ON "supplierFiscalDocumentRanges" (
  "supplierRtnNormalized",
  "cai",
  "documentRangeStartKey",
  "documentRangeEndKey"
);

WITH candidates AS (
  SELECT
    i."id" AS source_invoice_id,
    i."supplierId" AS supplier_id,
    trim(s."rtn") AS supplier_rtn,
    regexp_replace(coalesce(s."rtn", ''), '[^0-9]', '', 'g') AS supplier_rtn_normalized,
    trim(i."cai") AS cai,
    i."documentRangeStart" AS document_range_start,
    i."documentRangeEnd" AS document_range_end,
    regexp_replace(coalesce(i."documentRangeStart", ''), '[^0-9]', '', 'g') AS document_range_start_key,
    regexp_replace(coalesce(i."documentRangeEnd", ''), '[^0-9]', '', 'g') AS document_range_end_key,
    i."emissionDeadline" AS emission_deadline,
    coalesce(i."updatedAt", i."createdAt", now()) AS updated_at
  FROM "invoices" i
  INNER JOIN "suppliers" s ON s."id" = i."supplierId"
  WHERE
    i."isFiscalDocument" = true
    AND i."cai" IS NOT NULL
    AND trim(i."cai") <> ''
    AND i."documentRangeStart" IS NOT NULL
    AND i."documentRangeEnd" IS NOT NULL
    AND i."emissionDeadline" IS NOT NULL
    AND s."rtn" IS NOT NULL
)
INSERT INTO "supplierFiscalDocumentRanges" (
  "supplierId",
  "supplierRtn",
  "supplierRtnNormalized",
  "cai",
  "documentRangeStart",
  "documentRangeEnd",
  "documentRangeStartKey",
  "documentRangeEndKey",
  "emissionDeadline",
  "sourceInvoiceId",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT ON (
  supplier_rtn_normalized,
  cai,
  document_range_start_key,
  document_range_end_key
)
  supplier_id,
  supplier_rtn,
  supplier_rtn_normalized,
  cai,
  document_range_start,
  document_range_end,
  document_range_start_key,
  document_range_end_key,
  emission_deadline,
  source_invoice_id,
  now(),
  now()
FROM candidates
WHERE
  supplier_rtn_normalized <> ''
  AND length(document_range_start_key) = 16
  AND length(document_range_end_key) = 16
  AND document_range_start_key <= document_range_end_key
ORDER BY
  supplier_rtn_normalized,
  cai,
  document_range_start_key,
  document_range_end_key,
  updated_at DESC,
  source_invoice_id DESC
ON CONFLICT (
  "supplierRtnNormalized",
  "cai",
  "documentRangeStartKey",
  "documentRangeEndKey"
) DO NOTHING;
