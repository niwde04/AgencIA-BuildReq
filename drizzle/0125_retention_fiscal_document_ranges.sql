CREATE TABLE IF NOT EXISTS "retentionFiscalDocumentRanges" (
  "id" serial PRIMARY KEY,
  "cai" varchar(100) NOT NULL,
  "documentRangeStart" varchar(100) NOT NULL,
  "documentRangeEnd" varchar(100) NOT NULL,
  "documentRangeStartKey" varchar(32) NOT NULL,
  "documentRangeEndKey" varchar(32) NOT NULL,
  "emissionDeadline" timestamp NOT NULL,
  "sourceInvoiceId" integer REFERENCES "invoices"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ret_fiscal_range_order_check"
    CHECK ("documentRangeStartKey" <= "documentRangeEndKey")
);

CREATE INDEX IF NOT EXISTS "ret_fiscal_range_lookup_idx"
  ON "retentionFiscalDocumentRanges" (
    "documentRangeStartKey",
    "documentRangeEndKey"
  );

CREATE INDEX IF NOT EXISTS "ret_fiscal_range_source_invoice_idx"
  ON "retentionFiscalDocumentRanges" ("sourceInvoiceId");

CREATE UNIQUE INDEX IF NOT EXISTS "ret_fiscal_range_unique_idx"
  ON "retentionFiscalDocumentRanges" (
    "cai",
    "documentRangeStartKey",
    "documentRangeEndKey"
  );

ALTER TABLE "retentionFiscalDocumentRanges" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "retentionFiscalDocumentRanges" FROM anon;
    REVOKE ALL ON SEQUENCE "retentionFiscalDocumentRanges_id_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "retentionFiscalDocumentRanges" FROM authenticated;
    REVOKE ALL ON SEQUENCE "retentionFiscalDocumentRanges_id_seq"
      FROM authenticated;
  END IF;
END
$$;

WITH candidates AS (
  SELECT
    i."id" AS source_invoice_id,
    trim(i."retentionCai") AS cai,
    regexp_replace(
      coalesce(i."retentionReceiptNumber", ''),
      '[^0-9]',
      '',
      'g'
    ) AS receipt_number_key,
    i."retentionDocumentRangeStart" AS document_range_start,
    i."retentionDocumentRangeEnd" AS document_range_end,
    regexp_replace(
      coalesce(i."retentionDocumentRangeStart", ''),
      '[^0-9]',
      '',
      'g'
    ) AS document_range_start_key,
    regexp_replace(
      coalesce(i."retentionDocumentRangeEnd", ''),
      '[^0-9]',
      '',
      'g'
    ) AS document_range_end_key,
    i."retentionEmissionDeadline" AS emission_deadline,
    coalesce(i."updatedAt", i."createdAt", now()) AS updated_at
  FROM "invoices" i
  WHERE
    i."retentionReceiptNumber" IS NOT NULL
    AND trim(i."retentionReceiptNumber") <> ''
    AND i."retentionCai" IS NOT NULL
    AND trim(i."retentionCai") <> ''
    AND i."retentionDocumentRangeStart" IS NOT NULL
    AND i."retentionDocumentRangeEnd" IS NOT NULL
    AND i."retentionEmissionDeadline" IS NOT NULL
)
INSERT INTO "retentionFiscalDocumentRanges" (
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
  cai,
  document_range_start_key,
  document_range_end_key
)
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
  length(receipt_number_key) = 16
  AND length(document_range_start_key) = 16
  AND length(document_range_end_key) = 16
  AND document_range_start_key <= document_range_end_key
  AND receipt_number_key BETWEEN
    document_range_start_key AND document_range_end_key
ORDER BY
  cai,
  document_range_start_key,
  document_range_end_key,
  updated_at DESC,
  source_invoice_id DESC
ON CONFLICT (
  "cai",
  "documentRangeStartKey",
  "documentRangeEndKey"
) DO NOTHING;
