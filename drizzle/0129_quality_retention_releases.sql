CREATE TABLE IF NOT EXISTS "qualityRetentionReleases" (
  "id" serial PRIMARY KEY,
  "invoiceDocumentAdjustmentId" integer NOT NULL
    REFERENCES "invoiceDocumentAdjustments"("id") ON DELETE RESTRICT,
  "requestedAmount" numeric(14,4) NOT NULL,
  "approvedAmount" numeric(14,4),
  "justification" text NOT NULL,
  "status" varchar(40) DEFAULT 'pending_approval' NOT NULL,
  "requestedById" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "requestedAt" timestamp DEFAULT now() NOT NULL,
  "decidedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decidedAt" timestamp,
  "decisionComment" text,
  "cancelledById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "cancelledAt" timestamp,
  "cancellationReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "qrr_amount_check" CHECK (
    "requestedAmount" > 0 AND
    ("approvedAmount" IS NULL OR
      ("approvedAmount" > 0 AND "approvedAmount" <= "requestedAmount"))
  ),
  CONSTRAINT "qrr_status_check" CHECK (
    "status" IN (
      'pending_approval', 'approved', 'partially_paid',
      'paid', 'rejected', 'cancelled'
    )
  ),
  CONSTRAINT "qrr_justification_check"
    CHECK (length(btrim("justification")) >= 5)
);

CREATE INDEX IF NOT EXISTS "qrr_adjustment_idx"
  ON "qualityRetentionReleases" ("invoiceDocumentAdjustmentId");
CREATE INDEX IF NOT EXISTS "qrr_requester_idx"
  ON "qualityRetentionReleases" ("requestedById");
CREATE INDEX IF NOT EXISTS "qrr_decider_idx"
  ON "qualityRetentionReleases" ("decidedById");
CREATE INDEX IF NOT EXISTS "qrr_canceller_idx"
  ON "qualityRetentionReleases" ("cancelledById");
CREATE INDEX IF NOT EXISTS "qrr_status_created_idx"
  ON "qualityRetentionReleases" ("status", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "qrr_pending_adjustment_unique"
  ON "qualityRetentionReleases" ("invoiceDocumentAdjustmentId")
  WHERE "status" = 'pending_approval';

ALTER TABLE "treasuryPaymentItems"
  ADD COLUMN IF NOT EXISTS "qualityRetentionReleaseId" integer
    REFERENCES "qualityRetentionReleases"("id") ON DELETE RESTRICT;

ALTER TABLE "treasuryPaymentItems"
  DROP CONSTRAINT IF EXISTS "treasury_item_source_check";
ALTER TABLE "treasuryPaymentItems"
  ADD CONSTRAINT "treasury_item_source_check" CHECK (
    (
      "sourceType" = 'invoice'
      AND "invoiceId" IS NOT NULL
      AND "purchaseOrderAdvanceId" IS NULL
      AND "qualityRetentionReleaseId" IS NULL
    ) OR (
      "sourceType" = 'purchase_order_advance'
      AND "invoiceId" IS NULL
      AND "purchaseOrderAdvanceId" IS NOT NULL
      AND "qualityRetentionReleaseId" IS NULL
    ) OR (
      "sourceType" = 'quality_retention_release'
      AND "invoiceId" IS NOT NULL
      AND "purchaseOrderAdvanceId" IS NULL
      AND "qualityRetentionReleaseId" IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS "treasury_item_quality_release_idx"
  ON "treasuryPaymentItems" ("qualityRetentionReleaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "treasury_item_batch_quality_release_unique"
  ON "treasuryPaymentItems" ("batchId", "qualityRetentionReleaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "treasury_item_active_quality_release_unique"
  ON "treasuryPaymentItems" ("qualityRetentionReleaseId")
  WHERE "activeReservation" = true
    AND "sourceType" = 'quality_retention_release';

ALTER TABLE "qualityRetentionReleases" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "qualityRetentionReleases" FROM anon, authenticated;
REVOKE ALL ON SEQUENCE "qualityRetentionReleases_id_seq" FROM anon, authenticated;

CREATE OR REPLACE FUNCTION "guard_invoice_quality_release_void"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'anulada' AND OLD."status" IS DISTINCT FROM 'anulada'
    AND EXISTS (
      SELECT 1
      FROM "qualityRetentionReleases" release
      INNER JOIN "invoiceDocumentAdjustments" adjustment
        ON adjustment."id" = release."invoiceDocumentAdjustmentId"
      WHERE adjustment."invoiceId" = NEW."id"
        AND release."status" IN (
          'pending_approval', 'approved', 'partially_paid', 'paid'
        )
    )
  THEN
    RAISE EXCEPTION
      'No se puede anular una factura con liberaciones de retención activas o pagadas.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "invoice_quality_release_void_guard"
  ON "invoices";
CREATE TRIGGER "invoice_quality_release_void_guard"
BEFORE UPDATE OF "status" ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION "guard_invoice_quality_release_void"();
