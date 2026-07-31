DO $$ BEGIN
  CREATE TYPE "treasury_payment_kind" AS ENUM (
    'invoice',
    'purchase_order_advance'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "treasury_payment_source_type" AS ENUM (
    'invoice',
    'purchase_order_advance'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "attachment_entity_type"
  ADD VALUE IF NOT EXISTS 'purchase_order_advance';

CREATE TABLE IF NOT EXISTS "purchaseOrderAdvances" (
  "id" serial PRIMARY KEY,
  "advanceNumber" varchar(64) NOT NULL UNIQUE,
  "purchaseOrderId" integer NOT NULL REFERENCES "purchaseOrders"("id") ON DELETE RESTRICT,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "supplierId" integer NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "currency" varchar(3) NOT NULL,
  "requestedAmount" numeric(14,4) NOT NULL,
  "requestedPaymentDate" date NOT NULL,
  "notes" text,
  "createdById" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "cancelledById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "cancelledAt" timestamp,
  "cancellationReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "po_advance_currency_check"
    CHECK ("currency" IN ('HNL', 'USD')),
  CONSTRAINT "po_advance_amount_check"
    CHECK ("requestedAmount" > 0),
  CONSTRAINT "po_advance_cancellation_check"
    CHECK (
      (
        "cancelledAt" IS NULL
        AND "cancelledById" IS NULL
        AND "cancellationReason" IS NULL
      )
      OR
      (
        "cancelledAt" IS NOT NULL
        AND "cancelledById" IS NOT NULL
        AND length(btrim("cancellationReason")) >= 5
      )
    )
);

CREATE INDEX IF NOT EXISTS "po_advance_purchase_order_idx"
  ON "purchaseOrderAdvances" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "po_advance_purchase_order_state_idx"
  ON "purchaseOrderAdvances" ("purchaseOrderId", "cancelledAt");
CREATE INDEX IF NOT EXISTS "po_advance_project_idx"
  ON "purchaseOrderAdvances" ("projectId");
CREATE INDEX IF NOT EXISTS "po_advance_supplier_idx"
  ON "purchaseOrderAdvances" ("supplierId");
CREATE INDEX IF NOT EXISTS "po_advance_created_idx"
  ON "purchaseOrderAdvances" ("createdAt" DESC, "id" DESC);

CREATE TABLE IF NOT EXISTS "purchaseOrderAdvanceApplications" (
  "id" serial PRIMARY KEY,
  "purchaseOrderAdvanceId" integer NOT NULL
    REFERENCES "purchaseOrderAdvances"("id") ON DELETE RESTRICT,
  "invoiceId" integer NOT NULL
    REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "amount" numeric(14,4) NOT NULL,
  "appliedById" integer NOT NULL
    REFERENCES "users"("id") ON DELETE RESTRICT,
  "appliedAt" timestamp DEFAULT now() NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "po_advance_application_amount_check"
    CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "po_advance_application_advance_idx"
  ON "purchaseOrderAdvanceApplications" ("purchaseOrderAdvanceId");
CREATE INDEX IF NOT EXISTS "po_advance_application_invoice_idx"
  ON "purchaseOrderAdvanceApplications" ("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "po_advance_application_advance_invoice_unique"
  ON "purchaseOrderAdvanceApplications" ("purchaseOrderAdvanceId", "invoiceId");

ALTER TABLE "treasuryPaymentBatches"
  ADD COLUMN IF NOT EXISTS "paymentKind" "treasury_payment_kind"
  DEFAULT 'invoice' NOT NULL;

ALTER TABLE "treasuryPaymentItems"
  ADD COLUMN IF NOT EXISTS "sourceType" "treasury_payment_source_type"
  DEFAULT 'invoice' NOT NULL,
  ALTER COLUMN "invoiceId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "purchaseOrderAdvanceId" integer
    REFERENCES "purchaseOrderAdvances"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "appliedAdvanceAmount" numeric(14,4)
    DEFAULT 0 NOT NULL;

ALTER TABLE "treasuryPaymentItems"
  DROP CONSTRAINT IF EXISTS "treasury_item_amount_check";
ALTER TABLE "treasuryPaymentItems"
  ADD CONSTRAINT "treasury_item_amount_check"
  CHECK (
    "requestedAmount" > 0
    AND "invoiceNetPayable" > 0
    AND "previousPaidAmount" >= 0
    AND "appliedAdvanceAmount" >= 0
  );

ALTER TABLE "treasuryPaymentItems"
  DROP CONSTRAINT IF EXISTS "treasury_item_source_check";
ALTER TABLE "treasuryPaymentItems"
  ADD CONSTRAINT "treasury_item_source_check"
  CHECK (
    (
      "sourceType" = 'invoice'
      AND "invoiceId" IS NOT NULL
      AND "purchaseOrderAdvanceId" IS NULL
    )
    OR
    (
      "sourceType" = 'purchase_order_advance'
      AND "invoiceId" IS NULL
      AND "purchaseOrderAdvanceId" IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS "treasury_item_advance_idx"
  ON "treasuryPaymentItems" ("purchaseOrderAdvanceId");
CREATE UNIQUE INDEX IF NOT EXISTS "treasury_item_batch_advance_unique"
  ON "treasuryPaymentItems" ("batchId", "purchaseOrderAdvanceId");
DROP INDEX IF EXISTS "treasury_item_active_invoice_unique";
CREATE UNIQUE INDEX "treasury_item_active_invoice_unique"
  ON "treasuryPaymentItems" ("invoiceId")
  WHERE "activeReservation" = true AND "sourceType" = 'invoice';
CREATE UNIQUE INDEX IF NOT EXISTS "treasury_item_active_advance_unique"
  ON "treasuryPaymentItems" ("purchaseOrderAdvanceId")
  WHERE "activeReservation" = true
    AND "sourceType" = 'purchase_order_advance';

ALTER TABLE "purchaseOrderAdvances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchaseOrderAdvanceApplications" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "purchaseOrderAdvances" FROM anon, authenticated;
REVOKE ALL ON TABLE "purchaseOrderAdvanceApplications" FROM anon, authenticated;
