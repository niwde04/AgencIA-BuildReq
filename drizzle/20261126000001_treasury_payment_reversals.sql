CREATE TABLE IF NOT EXISTS "treasuryPaymentReversals" (
  "id" serial PRIMARY KEY,
  "clientRequestId" uuid NOT NULL,
  "batchId" integer NOT NULL REFERENCES "treasuryPaymentBatches"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'pending',
  "requestFingerprint" text NOT NULL,
  "requestedById" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decidedById" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "decisionComment" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "decidedAt" timestamptz,
  "evidenceAttachmentId" integer NOT NULL REFERENCES "attachments"("id") ON DELETE RESTRICT,
  "cause" text NOT NULL,
  "amountCents" bigint NOT NULL,
  CONSTRAINT tpr_cause_check CHECK ("cause" IN ('no_disbursement', 'bank_return')),
  CONSTRAINT tpr_amount_check CHECK ("amountCents" BETWEEN 1 AND 9007199254740991),
  CONSTRAINT tpr_decision_check CHECK (
    ("status" = 'pending' AND "decidedAt" IS NULL AND "decidedById" IS NULL AND "decisionComment" IS NULL)
    OR
    ("status" IN ('approved', 'rejected') AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL AND "decidedById" <> "requestedById")
  )
);

CREATE TABLE IF NOT EXISTS "treasuryPaymentReversalItems" (
  "id" serial PRIMARY KEY,
  "reversalId" integer NOT NULL REFERENCES "treasuryPaymentReversals"("id") ON DELETE RESTRICT,
  "paymentItemId" integer NOT NULL REFERENCES "treasuryPaymentItems"("id") ON DELETE RESTRICT,
  "reason" text NOT NULL,
  "amountCents" bigint NOT NULL,
  "appliedAt" timestamptz,
  CONSTRAINT tpri_reason_check CHECK (length(btrim("reason")) BETWEEN 5 AND 2000),
  CONSTRAINT tpri_amount_check CHECK ("amountCents" BETWEEN 1 AND 9007199254740991)
);

CREATE UNIQUE INDEX IF NOT EXISTS tpr_client_request_unique
  ON "treasuryPaymentReversals"("clientRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS tpr_pending_batch_unique
  ON "treasuryPaymentReversals"("batchId") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS tpr_batch_history_idx
  ON "treasuryPaymentReversals"("batchId", "id" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tpri_reversal_item_unique
  ON "treasuryPaymentReversalItems"("reversalId", "paymentItemId");
CREATE UNIQUE INDEX IF NOT EXISTS tpri_applied_item_unique
  ON "treasuryPaymentReversalItems"("paymentItemId") WHERE "appliedAt" IS NOT NULL;

ALTER TABLE "purchaseOrderAdvances"
  ADD COLUMN IF NOT EXISTS "reversalHoldId" integer
  REFERENCES "treasuryPaymentReversals"("id") ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS po_advance_reversal_hold_idx
  ON "purchaseOrderAdvances"("reversalHoldId") WHERE "reversalHoldId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."treasuryPaymentItems"'::regclass
      AND conname = 'treasury_item_reversal_check'
  ) THEN
    ALTER TABLE "treasuryPaymentItems"
      ADD CONSTRAINT treasury_item_reversal_check CHECK (
        "status" <> 'revertida' OR (
          "sourceType" = 'purchase_order_advance'
          AND NOT "activeReservation"
          AND "bankPaidAmount" IS NOT NULL
          AND "bankPaidAmount" > 0
          AND "accountedAt" IS NULL
          AND "accountedById" IS NULL
        )
      );
  END IF;
END;
$$;

ALTER TABLE "treasuryPaymentReversals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treasuryPaymentReversalItems" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "treasuryPaymentReversals", "treasuryPaymentReversalItems" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "treasuryPaymentReversals_id_seq", "treasuryPaymentReversalItems_id_seq" FROM PUBLIC;

DO $$
DECLARE browser_role name;
BEGIN
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format(
      'REVOKE ALL ON public."treasuryPaymentReversals", public."treasuryPaymentReversalItems" FROM %I',
      browser_role
    );
    EXECUTE format(
      'REVOKE ALL ON SEQUENCE public."treasuryPaymentReversals_id_seq", public."treasuryPaymentReversalItems_id_seq" FROM %I',
      browser_role
    );
  END LOOP;
END;
$$;

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.guard_treasury_payment_reversal_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'No se puede eliminar el historial de reversión de Tesorería' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'treasuryPaymentReversals' THEN
    IF OLD."status" <> 'pending' OR NEW."status" NOT IN ('approved', 'rejected')
      OR (to_jsonb(OLD) - ARRAY['status', 'decidedAt', 'decidedById', 'decisionComment'])
        IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'decidedAt', 'decidedById', 'decisionComment']) THEN
      RAISE EXCEPTION 'Solo se puede decidir una solicitud de reversión pendiente' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."appliedAt" IS NOT NULL OR NEW."appliedAt" IS NULL
    OR (to_jsonb(OLD) - 'appliedAt') IS DISTINCT FROM (to_jsonb(NEW) - 'appliedAt') THEN
    RAISE EXCEPTION 'Solo se puede registrar una vez la aplicación de una reversión' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_treasury_payment_reversal_history() FROM PUBLIC;

DROP TRIGGER IF EXISTS tpr_history_guard ON "treasuryPaymentReversals";
CREATE TRIGGER tpr_history_guard
  BEFORE UPDATE OR DELETE ON "treasuryPaymentReversals"
  FOR EACH ROW EXECUTE FUNCTION private.guard_treasury_payment_reversal_history();

DROP TRIGGER IF EXISTS tpri_history_guard ON "treasuryPaymentReversalItems";
CREATE TRIGGER tpri_history_guard
  BEFORE UPDATE OR DELETE ON "treasuryPaymentReversalItems"
  FOR EACH ROW EXECUTE FUNCTION private.guard_treasury_payment_reversal_history();
