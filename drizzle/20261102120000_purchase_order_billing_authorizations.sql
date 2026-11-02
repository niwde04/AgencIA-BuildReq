-- Additive. Apply explicitly before deploying the authorization feature.
CREATE TABLE IF NOT EXISTS "purchaseOrderBillingAuthorizations" (
  "id" serial PRIMARY KEY,
  "purchaseOrderId" integer NOT NULL REFERENCES "purchaseOrders"("id") ON DELETE RESTRICT,
  "authorizedUntil" date NOT NULL,
  "originalExpectedInvoiceCount" integer NOT NULL,
  "additionalInvoiceCount" integer NOT NULL,
  "maxInvoiceCount" integer NOT NULL,
  "maxAmount" numeric(18,4),
  "reason" text NOT NULL,
  "supportAttachmentId" integer NOT NULL REFERENCES "attachments"("id") ON DELETE RESTRICT,
  "authorizedById" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "authorizedAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "revokedById" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "revokeReason" text,
  CONSTRAINT poba_limits_check CHECK ("originalExpectedInvoiceCount" > 0 AND "additionalInvoiceCount" BETWEEN 0 AND 600 AND "maxInvoiceCount" = "originalExpectedInvoiceCount" + "additionalInvoiceCount"),
  CONSTRAINT poba_amount_check CHECK ("maxAmount" IS NULL OR "maxAmount" > 0),
  CONSTRAINT poba_reason_check CHECK (length(btrim("reason")) BETWEEN 10 AND 2000),
  CONSTRAINT poba_revoke_check CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL AND "revokeReason" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokeReason" IS NOT NULL AND length(btrim("revokeReason")) BETWEEN 10 AND 2000))
);
CREATE UNIQUE INDEX IF NOT EXISTS poba_active_order_unique ON "purchaseOrderBillingAuthorizations"("purchaseOrderId") WHERE "revokedAt" IS NULL;
CREATE INDEX IF NOT EXISTS poba_order_history_idx ON "purchaseOrderBillingAuthorizations"("purchaseOrderId", "id" DESC);
CREATE TABLE IF NOT EXISTS "purchaseOrderBillingAuthorizationUses" (
  "id" serial PRIMARY KEY,
  "authorizationId" integer NOT NULL REFERENCES "purchaseOrderBillingAuthorizations"("id") ON DELETE RESTRICT,
  "invoiceId" integer NOT NULL UNIQUE REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "receiptId" integer NOT NULL UNIQUE REFERENCES "receipts"("id") ON DELETE RESTRICT,
  "amount" numeric(18,4) NOT NULL CONSTRAINT pobau_amount_check CHECK ("amount" >= 0),
  "documentDate" date NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pobau_authorization_idx ON "purchaseOrderBillingAuthorizationUses"("authorizationId");
ALTER TABLE "purchaseOrderBillingAuthorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchaseOrderBillingAuthorizationUses" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "purchaseOrderBillingAuthorizations", "purchaseOrderBillingAuthorizationUses" FROM anon;
    REVOKE ALL ON SEQUENCE "purchaseOrderBillingAuthorizations_id_seq", "purchaseOrderBillingAuthorizationUses_id_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "purchaseOrderBillingAuthorizations", "purchaseOrderBillingAuthorizationUses" FROM authenticated;
    REVOKE ALL ON SEQUENCE "purchaseOrderBillingAuthorizations_id_seq", "purchaseOrderBillingAuthorizationUses_id_seq" FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON "purchaseOrderBillingAuthorizations", "purchaseOrderBillingAuthorizationUses" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "purchaseOrderBillingAuthorizations_id_seq", "purchaseOrderBillingAuthorizationUses_id_seq" FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.guard_purchase_order_billing_history() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'purchaseOrderBillingAuthorizationUses' THEN
    RAISE EXCEPTION 'Billing authorization history is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR (to_jsonb(OLD) - 'revokedAt' - 'revokedById' - 'revokeReason') IS DISTINCT FROM (to_jsonb(NEW) - 'revokedAt' - 'revokedById' - 'revokeReason') THEN
    RAISE EXCEPTION 'Only revocation of an active authorization is permitted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_purchase_order_billing_history() FROM PUBLIC;
DROP TRIGGER IF EXISTS poba_history_guard ON "purchaseOrderBillingAuthorizations";
CREATE TRIGGER poba_history_guard BEFORE UPDATE OR DELETE ON "purchaseOrderBillingAuthorizations" FOR EACH ROW EXECUTE FUNCTION private.guard_purchase_order_billing_history();
DROP TRIGGER IF EXISTS pobau_history_guard ON "purchaseOrderBillingAuthorizationUses";
CREATE TRIGGER pobau_history_guard BEFORE UPDATE OR DELETE ON "purchaseOrderBillingAuthorizationUses" FOR EACH ROW EXECUTE FUNCTION private.guard_purchase_order_billing_history();

-- Corrections to an invoice must remain inside the authorization that admitted it.
-- Revocation or expiry affects future receptions, never invalidates received invoices.
CREATE OR REPLACE FUNCTION private.guard_authorized_purchase_order_invoice() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE billing_auth public."purchaseOrderBillingAuthorizations"%ROWTYPE;
DECLARE used_total numeric;
DECLARE original_end timestamp;
DECLARE is_contract boolean;
BEGIN
  SELECT a.* INTO billing_auth FROM public."purchaseOrderBillingAuthorizations" a
    JOIN public."purchaseOrderBillingAuthorizationUses" u ON u."authorizationId"=a.id
    WHERE u."invoiceId"=OLD.id;
  IF NOT FOUND THEN
    IF NEW."documentDate" IS DISTINCT FROM OLD."documentDate" THEN
      SELECT p."contractEndDate",p."appliesContract" INTO original_end,is_contract
        FROM public."purchaseOrders" p WHERE p.id=NEW."purchaseOrderId" FOR UPDATE;
      IF is_contract AND NEW."documentDate"::date > original_end::date THEN
        RAISE EXCEPTION 'Para cambiar a una fecha posterior al contrato, anule y registre una recepción autorizada' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."purchaseOrderId" IS DISTINCT FROM OLD."purchaseOrderId" OR NEW."receiptId" IS DISTINCT FROM OLD."receiptId" THEN
    RAISE EXCEPTION 'La factura debe conservar la OC y recepción de su autorización' USING ERRCODE='23514';
  END IF;
  IF NEW."documentDate" IS NULL OR NEW."documentDate"::date > billing_auth."authorizedUntil" THEN
    RAISE EXCEPTION 'La fecha del documento supera la fecha límite de la autorización' USING ERRCODE='23514';
  END IF;
  IF OLD.status='anulada' AND NEW.status<>'anulada' THEN
    RAISE EXCEPTION 'Una factura autorizada anulada requiere una nueva recepción; no puede reactivarse' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."purchaseOrders" WHERE id=billing_auth."purchaseOrderId" FOR UPDATE;
  IF billing_auth."maxAmount" IS NOT NULL AND NEW.status<>'anulada' THEN
    SELECT coalesce(sum(i.total),0) INTO used_total
      FROM public."purchaseOrderBillingAuthorizationUses" u JOIN public.invoices i ON i.id=u."invoiceId"
      WHERE u."authorizationId"=billing_auth.id AND i.status<>'anulada' AND i.id<>OLD.id;
    IF used_total + NEW.total > billing_auth."maxAmount" THEN
      RAISE EXCEPTION 'El importe de la factura supera el saldo de la autorización' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_authorized_purchase_order_invoice() FROM PUBLIC;
DROP TRIGGER IF EXISTS authorized_po_invoice_guard ON public.invoices;
CREATE TRIGGER authorized_po_invoice_guard BEFORE UPDATE OF "purchaseOrderId","receiptId","documentDate",total,status ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.guard_authorized_purchase_order_invoice();
