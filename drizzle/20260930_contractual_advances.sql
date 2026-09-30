BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "purchaseOrderAdvances"
 ADD COLUMN IF NOT EXISTS "applicationMode" varchar(20) NOT NULL DEFAULT 'direct',
 ADD COLUMN IF NOT EXISTS "requestedPercentage" numeric(5,2),
 ADD COLUMN IF NOT EXISTS "amortizationMode" varchar(20),
 ADD COLUMN IF NOT EXISTS "amortizationValue" numeric(14,4),
 ADD COLUMN IF NOT EXISTS "amortizationBase" varchar(20);
ALTER TABLE "purchaseOrderAdvanceApplications"
 ADD COLUMN IF NOT EXISTS "applicationMode" varchar(20) NOT NULL DEFAULT 'direct',
 ADD COLUMN IF NOT EXISTS "invoiceDocumentAdjustmentId" integer REFERENCES "invoiceDocumentAdjustments"(id) ON DELETE RESTRICT;
ALTER TABLE "treasuryPaymentItems" ADD COLUMN IF NOT EXISTS "contractualAmortizationAmount" numeric(14,4) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "invoiceContractualAmortizations" (
 "invoiceId" integer PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
 "purchaseOrderId" integer NOT NULL REFERENCES "purchaseOrders"(id) ON DELETE RESTRICT,
 "invoiceDocumentAdjustmentId" integer REFERENCES "invoiceDocumentAdjustments"(id) ON DELETE SET NULL,
 "inputMode" varchar(20) NOT NULL, "inputValue" numeric(14,4) NOT NULL,
 "baseKind" varchar(20) NOT NULL, "baseAmount" numeric(14,4) NOT NULL,
 "proposedAmount" numeric(14,4) NOT NULL, amount numeric(14,4) NOT NULL,
 "overrideReason" text, "updatedById" integer REFERENCES users(id) ON DELETE RESTRICT,
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_contractual_amount_check CHECK (amount>=0 AND amount<="baseAmount" AND "inputValue">=0 AND "proposedAmount">=0),
 CONSTRAINT invoice_contractual_mode_check CHECK ("inputMode" IN ('percentage','amount') AND "baseKind" IN ('subtotal','total') AND ("inputMode"<>'percentage' OR "inputValue"<=100))
);
CREATE INDEX IF NOT EXISTS invoice_contractual_order_idx ON "invoiceContractualAmortizations"("purchaseOrderId");
CREATE TABLE IF NOT EXISTS "advanceFinancialEvents" (
 id serial PRIMARY KEY, "purchaseOrderId" integer NOT NULL REFERENCES "purchaseOrders"(id) ON DELETE RESTRICT,
 "invoiceId" integer REFERENCES invoices(id) ON DELETE RESTRICT,
 "actorId" integer REFERENCES users(id) ON DELETE RESTRICT, "actorLabel" varchar(200) NOT NULL,
 action varchar(60) NOT NULL, reason text NOT NULL, "before" jsonb, "after" jsonb,
 "operationKey" varchar(200) UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advance_events_order_idx ON "advanceFinancialEvents"("purchaseOrderId",id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"purchaseOrderAdvances"'::regclass AND conname='po_advance_treatment_check') THEN
  ALTER TABLE "purchaseOrderAdvances" ADD CONSTRAINT po_advance_treatment_check CHECK (
   ("applicationMode"='direct' AND "amortizationMode" IS NULL AND "amortizationValue" IS NULL AND "amortizationBase" IS NULL)
   OR ("applicationMode"='contractual' AND "amortizationMode" IS NOT NULL AND "amortizationMode" IN ('percentage','amount') AND "amortizationValue" IS NOT NULL AND "amortizationValue">0 AND "amortizationBase" IS NOT NULL AND "amortizationBase" IN ('subtotal','total') AND ("amortizationMode"<>'percentage' OR "amortizationValue"<=100)));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"purchaseOrderAdvanceApplications"'::regclass AND conname='po_advance_application_treatment_check') THEN
  ALTER TABLE "purchaseOrderAdvanceApplications" ADD CONSTRAINT po_advance_application_treatment_check CHECK (
   ("applicationMode"='direct' AND "invoiceDocumentAdjustmentId" IS NULL) OR ("applicationMode"='contractual' AND "invoiceDocumentAdjustmentId" IS NOT NULL));
 END IF;
END $$;
-- Protect provenance even if a future caller bypasses the application service.
CREATE OR REPLACE FUNCTION public.validate_contractual_advance_application() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE a "purchaseOrderAdvances"; i invoices; d "invoiceDocumentAdjustments";
BEGIN
 SELECT * INTO a FROM "purchaseOrderAdvances" WHERE id=NEW."purchaseOrderAdvanceId";
 SELECT * INTO i FROM invoices WHERE id=NEW."invoiceId";
 IF a."purchaseOrderId" IS DISTINCT FROM i."purchaseOrderId" OR a."supplierId" IS DISTINCT FROM i."supplierId" OR a."projectId" IS DISTINCT FROM i."projectId" OR a.currency IS DISTINCT FROM i.currency OR a."applicationMode" IS DISTINCT FROM NEW."applicationMode" THEN
  RAISE EXCEPTION 'La aplicación del anticipo no corresponde a la misma operación o tratamiento';
 END IF;
 IF NEW."applicationMode"='contractual' THEN
  SELECT * INTO d FROM "invoiceDocumentAdjustments" WHERE id=NEW."invoiceDocumentAdjustmentId";
  IF d."invoiceId" IS DISTINCT FROM NEW."invoiceId" OR d."adjustmentType" IS DISTINCT FROM 'advance_amortization' THEN RAISE EXCEPTION 'La aplicación contractual requiere su amortización documental'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contractual_advance_application_origin ON "purchaseOrderAdvanceApplications";
CREATE TRIGGER contractual_advance_application_origin BEFORE INSERT OR UPDATE ON "purchaseOrderAdvanceApplications" FOR EACH ROW EXECUTE FUNCTION public.validate_contractual_advance_application();
ALTER TABLE "invoiceContractualAmortizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advanceFinancialEvents" ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON TABLE "invoiceContractualAmortizations", "advanceFinancialEvents" FROM %I',r);
   EXECUTE format('REVOKE ALL ON SEQUENCE "advanceFinancialEvents_id_seq" FROM %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
