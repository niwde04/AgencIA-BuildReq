ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "otherRetentionTotal" numeric(14,4)
    DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "documentDiscountTotal" numeric(14,4)
    DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "invoiceDocumentAdjustments" (
  "id" serial PRIMARY KEY,
  "invoiceId" integer NOT NULL
    REFERENCES "invoices"("id") ON DELETE CASCADE,
  "adjustmentType" varchar(40) NOT NULL,
  "percentage" numeric(5,2) NOT NULL,
  "baseAmount" numeric(14,4) NOT NULL,
  "amount" numeric(14,4) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "invda_adjustment_type_check"
    CHECK (
      "adjustmentType" IN (
        'quality_retention',
        'advance_amortization',
        'prompt_payment_discount',
        'tc_discount'
      )
    ),
  CONSTRAINT "invda_percentage_check"
    CHECK ("percentage" > 0 AND "percentage" <= 100),
  CONSTRAINT "invda_amount_check"
    CHECK ("baseAmount" >= 0 AND "amount" >= 0)
);

CREATE INDEX IF NOT EXISTS "invda_invoice_idx"
  ON "invoiceDocumentAdjustments" ("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "invda_invoice_type_unique"
  ON "invoiceDocumentAdjustments" ("invoiceId", "adjustmentType");

ALTER TABLE "invoiceDocumentAdjustments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "invoiceDocumentAdjustments" FROM anon, authenticated;
REVOKE ALL ON SEQUENCE "invoiceDocumentAdjustments_id_seq"
  FROM anon, authenticated;
