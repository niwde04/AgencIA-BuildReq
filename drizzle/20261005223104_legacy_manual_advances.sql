-- Expand only. Historical advances are enabled separately, after compatible code is deployed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261005, 223104);

ALTER TABLE "invoiceContractualAmortizations"
 ADD COLUMN IF NOT EXISTS treatment varchar(20) NOT NULL DEFAULT 'contractual';

ALTER TABLE "purchaseOrderAdvances" DROP CONSTRAINT IF EXISTS po_advance_treatment_check;
ALTER TABLE "purchaseOrderAdvances" ADD CONSTRAINT po_advance_treatment_check CHECK (
 ("applicationMode" IN ('direct','legacy_manual') AND "amortizationMode" IS NULL AND "amortizationValue" IS NULL AND "amortizationBase" IS NULL)
 OR ("applicationMode"='contractual' AND "amortizationMode" IS NOT NULL AND "amortizationMode" IN ('percentage','amount')
 AND "amortizationValue" IS NOT NULL AND "amortizationValue">0 AND "amortizationBase" IS NOT NULL
 AND "amortizationBase" IN ('subtotal','total') AND ("amortizationMode"<>'percentage' OR "amortizationValue"<=100))
);
ALTER TABLE "purchaseOrderAdvanceApplications" DROP CONSTRAINT IF EXISTS po_advance_application_treatment_check;
ALTER TABLE "purchaseOrderAdvanceApplications" ADD CONSTRAINT po_advance_application_treatment_check CHECK (
 ("applicationMode"='direct' AND "invoiceDocumentAdjustmentId" IS NULL)
 OR ("applicationMode" IN ('contractual','legacy_manual') AND "invoiceDocumentAdjustmentId" IS NOT NULL)
);
ALTER TABLE "invoiceContractualAmortizations" DROP CONSTRAINT IF EXISTS invoice_amortization_treatment_check;
ALTER TABLE "invoiceContractualAmortizations" ADD CONSTRAINT invoice_amortization_treatment_check CHECK (
 treatment='contractual' OR (treatment='legacy_manual' AND "baseKind"='subtotal' AND "proposedAmount"=0 AND "overrideReason" IS NULL)
);

CREATE OR REPLACE FUNCTION public.validate_contractual_advance_application()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE a "purchaseOrderAdvances"; i invoices; d "invoiceDocumentAdjustments"; c "invoiceContractualAmortizations";
BEGIN
 SELECT * INTO a FROM "purchaseOrderAdvances" WHERE id=NEW."purchaseOrderAdvanceId";
 SELECT * INTO i FROM invoices WHERE id=NEW."invoiceId";
 IF a.id IS NULL OR i.id IS NULL OR a."purchaseOrderId" IS DISTINCT FROM i."purchaseOrderId"
 OR a."supplierId" IS DISTINCT FROM i."supplierId" OR a."projectId" IS DISTINCT FROM i."projectId"
 OR a.currency IS DISTINCT FROM i.currency OR a."applicationMode" IS DISTINCT FROM NEW."applicationMode" THEN
  RAISE EXCEPTION 'La aplicación del anticipo no corresponde a la misma operación o tratamiento';
 END IF;
 IF NEW."applicationMode" IN ('contractual','legacy_manual') THEN
  SELECT * INTO d FROM "invoiceDocumentAdjustments" WHERE id=NEW."invoiceDocumentAdjustmentId";
  IF d.id IS NULL OR d."invoiceId" IS DISTINCT FROM NEW."invoiceId" OR d."adjustmentType" IS DISTINCT FROM 'advance_amortization' THEN
   RAISE EXCEPTION 'La aplicación requiere su amortización documental';
  END IF;
 END IF;
 IF NEW."applicationMode"='legacy_manual' THEN
  SELECT * INTO c FROM "invoiceContractualAmortizations" WHERE "invoiceId"=NEW."invoiceId";
  IF c."invoiceId" IS NULL OR c.treatment IS DISTINCT FROM 'legacy_manual'
  OR c."purchaseOrderId" IS DISTINCT FROM a."purchaseOrderId" OR c."invoiceDocumentAdjustmentId" IS DISTINCT FROM d.id
  OR round(c.amount,2) IS DISTINCT FROM round(d.amount,2) OR i.status IS DISTINCT FROM 'registrada'
  OR NEW.amount<=0 OR NEW.amount<>round(NEW.amount,2)
  OR NEW.amount + coalesce((SELECT sum(p.amount) FROM "purchaseOrderAdvanceApplications" p
      WHERE p."invoiceId"=NEW."invoiceId" AND p.id IS DISTINCT FROM NEW.id),0)>c.amount THEN
   RAISE EXCEPTION 'La aplicación histórica no coincide con su control de amortización documental';
  END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
