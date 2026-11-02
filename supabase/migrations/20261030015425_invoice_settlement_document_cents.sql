-- Expand only. No existing invoice, receipt, payment or policy is rewritten.
-- Publish compatible readers before enabling settings and the audited unpaid batch.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(20261030,15425);
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS "invoiceSettlementActivations" (
  id serial PRIMARY KEY,
  "operationKey" varchar(200) NOT NULL UNIQUE,
  "actorId" integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "before" jsonb NOT NULL,
  "after" jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS "invoiceSettlementSettings" (
  id integer PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  version varchar(40) NOT NULL DEFAULT 'document_cents_v1',
  "activatedById" integer REFERENCES users(id) ON DELETE RESTRICT,
  "activatedAt" timestamptz,
  CONSTRAINT invoice_settlement_settings_singleton CHECK(id=1),
  CONSTRAINT invoice_settlement_settings_version CHECK(version='document_cents_v1'),
  CONSTRAINT invoice_settlement_settings_activation CHECK(
    NOT enabled OR ("activatedById" IS NOT NULL AND "activatedAt" IS NOT NULL)
  )
);
INSERT INTO "invoiceSettlementSettings"(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS "invoiceSettlementPolicies" (
  "invoiceId" integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  version varchar(40) NOT NULL,
  source varchar(20) NOT NULL,
  "activatedById" integer REFERENCES users(id) ON DELETE RESTRICT,
  "activatedAt" timestamptz NOT NULL DEFAULT now(),
  "operationKey" varchar(200),
  CONSTRAINT invoice_settlement_policy_version CHECK(version='document_cents_v1'),
  CONSTRAINT invoice_settlement_policy_source CHECK(source IN ('new_invoice','unpaid_batch')),
  CONSTRAINT invoice_settlement_batch_audit CHECK(
    source<>'unpaid_batch' OR ("operationKey" IS NOT NULL AND "activatedById" IS NOT NULL)
  ),
  CONSTRAINT invoice_settlement_policy_activation_fk FOREIGN KEY("operationKey")
    REFERENCES "invoiceSettlementActivations"("operationKey") ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);
-- The disposable Drizzle-generated schema starts with a regular FK; bring it
-- to the same deferred contract without dropping any key or historical row.
ALTER TABLE "invoiceSettlementPolicies"
  ALTER CONSTRAINT invoice_settlement_policy_activation_fk DEFERRABLE INITIALLY DEFERRED;

-- Every payment writer uses the invoice lock. These checks run after acquiring
-- it, so an enrollment cannot race an invoice payout or an advance allocation.
CREATE OR REPLACE FUNCTION private.invoice_has_settlement_history(p_invoice_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public."treasuryPaymentItems" t
    LEFT JOIN public."qualityRetentionReleases" q ON q.id=t."qualityRetentionReleaseId"
    LEFT JOIN public."invoiceDocumentAdjustments" d ON d.id=q."invoiceDocumentAdjustmentId"
    WHERE t."invoiceId"=p_invoice_id OR d."invoiceId"=p_invoice_id
  ) OR EXISTS(
    SELECT 1 FROM public."purchaseOrderAdvanceApplications" a
    WHERE a."invoiceId"=p_invoice_id
  )
$$;

CREATE OR REPLACE FUNCTION private.invoice_settlement_policy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
DECLARE v_invoice public.invoices%ROWTYPE; v_enabled boolean; v_version varchar(40);
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'La política de liquidación de la factura es inmutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    -- Only an invoice deletion that passed the parent guard may cascade here.
    IF pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=OLD."invoiceId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'La política de liquidación sólo se retira al eliminar su borrador sin movimientos' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id=NEW."invoiceId" FOR UPDATE;
  IF NOT FOUND OR v_invoice.status='anulada' THEN
    RAISE EXCEPTION 'La factura no está disponible para una política de liquidación' USING ERRCODE='23514';
  END IF;
  SELECT enabled,version INTO v_enabled,v_version FROM public."invoiceSettlementSettings" WHERE id=1 FOR SHARE;
  IF NOT coalesce(v_enabled,false) OR v_version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'La política de liquidación todavía no está habilitada' USING ERRCODE='23514';
  END IF;
  IF private.invoice_has_settlement_history(v_invoice.id) THEN
    RAISE EXCEPTION 'La factura tiene historial de pagos, lotes o anticipos y conserva su política anterior' USING ERRCODE='23514';
  END IF;
  IF v_invoice."netPayable"<0 OR v_invoice."netPayable" IS DISTINCT FROM
    round(v_invoice.total-v_invoice."retentionTotal"-v_invoice."otherRetentionTotal"
      -v_invoice."documentDiscountTotal"-v_invoice."creditNoteTotal"+v_invoice."debitNoteTotal",4) THEN
    RAISE EXCEPTION 'Los importes originales de la factura no concilian' USING ERRCODE='23514';
  END IF;
  IF NEW.source='unpaid_batch' AND NOT EXISTS(
    SELECT 1 FROM public.users WHERE id=NEW."activatedById" AND "isActive" AND role='admin'
  ) THEN
    RAISE EXCEPTION 'La activación en lote requiere un administrador activo' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_settlement_policy_guard ON "invoiceSettlementPolicies";
CREATE TRIGGER invoice_settlement_policy_guard BEFORE INSERT OR UPDATE OR DELETE
  ON "invoiceSettlementPolicies" FOR EACH ROW EXECUTE FUNCTION private.invoice_settlement_policy_guard();

CREATE OR REPLACE FUNCTION private.invoice_settlement_batch_audit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.source='unpaid_batch' AND NOT EXISTS(
    SELECT 1 FROM public."invoiceSettlementActivations" a
    WHERE a."operationKey"=NEW."operationKey" AND a."actorId"=NEW."activatedById"
  ) THEN
    RAISE EXCEPTION 'La activación de liquidación requiere su auditoría en la misma operación' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_settlement_batch_audit_guard ON "invoiceSettlementPolicies";
CREATE CONSTRAINT TRIGGER invoice_settlement_batch_audit_guard AFTER INSERT
  ON "invoiceSettlementPolicies" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION private.invoice_settlement_batch_audit_guard();

CREATE OR REPLACE FUNCTION private.invoice_settlement_parent_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public."invoiceSettlementPolicies" WHERE "invoiceId"=OLD.id) THEN
    IF OLD.status NOT IN ('borrador','rechazada') OR private.invoice_has_settlement_history(OLD.id) THEN
      RAISE EXCEPTION 'Sólo puede eliminarse el borrador con política de liquidación si no tiene movimientos' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS invoice_settlement_parent_delete_guard ON invoices;
CREATE TRIGGER invoice_settlement_parent_delete_guard BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION private.invoice_settlement_parent_delete_guard();

CREATE OR REPLACE FUNCTION private.invoice_settlement_activation_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría de políticas de liquidación es inmutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS invoice_settlement_activation_immutable ON "invoiceSettlementActivations";
CREATE TRIGGER invoice_settlement_activation_immutable BEFORE UPDATE OR DELETE
  ON "invoiceSettlementActivations" FOR EACH ROW EXECUTE FUNCTION private.invoice_settlement_activation_immutable();

ALTER TABLE "invoiceSettlementPolicies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceSettlementSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceSettlementActivations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "invoiceSettlementPolicies","invoiceSettlementSettings","invoiceSettlementActivations" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "invoiceSettlementActivations_id_seq" FROM PUBLIC;
REVOKE ALL ON FUNCTION private.invoice_has_settlement_history(integer),
  private.invoice_settlement_policy_guard(),private.invoice_settlement_batch_audit_guard(),
  private.invoice_settlement_parent_delete_guard(),private.invoice_settlement_activation_immutable() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."invoiceSettlementPolicies",public."invoiceSettlementSettings",public."invoiceSettlementActivations" FROM %I',r);
      EXECUTE format('REVOKE ALL ON SEQUENCE public."invoiceSettlementActivations_id_seq" FROM %I',r);
      EXECUTE format('REVOKE ALL ON FUNCTION private.invoice_has_settlement_history(integer),private.invoice_settlement_policy_guard(),private.invoice_settlement_batch_audit_guard(),private.invoice_settlement_parent_delete_guard(),private.invoice_settlement_activation_immutable() FROM %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
