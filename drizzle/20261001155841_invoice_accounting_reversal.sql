-- Apply after 20260930120000_retention_documents.sql, in one transaction.
-- No existing invoices, balances, retention snapshots or attachments are rewritten.
CREATE TABLE IF NOT EXISTS "invoiceAccountingReversals" (
  id serial PRIMARY KEY,
  "invoiceId" integer NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  "actorId" integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 2000),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "transactionId" bigint NOT NULL DEFAULT txid_current(),
  "invoiceSnapshot" jsonb NOT NULL CHECK ("invoiceSnapshot"->>'status' = 'registrada')
);
CREATE INDEX IF NOT EXISTS iar_invoice_history_idx ON "invoiceAccountingReversals" ("invoiceId", id DESC);
ALTER TABLE "invoiceAccountingReversals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "invoiceAccountingReversals", "invoiceAccountingReversals_id_seq" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON "invoiceAccountingReversals", "invoiceAccountingReversals_id_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON "invoiceAccountingReversals", "invoiceAccountingReversals_id_seq" FROM authenticated;
  END IF;
END $$;

ALTER TABLE "retentionDocuments" ADD COLUMN IF NOT EXISTS "voidedAt" timestamptz;
ALTER TABLE "retentionDocuments" ADD COLUMN IF NOT EXISTS "voidedById" integer REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE "retentionDocuments" ADD COLUMN IF NOT EXISTS "voidReason" text;
ALTER TABLE "retentionDocuments" ADD COLUMN IF NOT EXISTS "reversalId" integer REFERENCES "invoiceAccountingReversals"(id) ON DELETE RESTRICT;
ALTER TABLE "retentionDocuments" DROP CONSTRAINT IF EXISTS rd_status_check;
ALTER TABLE "retentionDocuments" ADD CONSTRAINT rd_status_check CHECK (status IN ('registrada','historico','anulada'));
ALTER TABLE "retentionDocuments" DROP CONSTRAINT IF EXISTS rd_void_check;
ALTER TABLE "retentionDocuments" ADD CONSTRAINT rd_void_check CHECK (
  (status='anulada' AND "voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND
    "reversalId" IS NOT NULL AND length(btrim("voidReason")) BETWEEN 5 AND 2000)
  OR (status<>'anulada' AND "voidedAt" IS NULL AND "voidedById" IS NULL AND
    "reversalId" IS NULL AND "voidReason" IS NULL)
);

-- Only cancellation metadata may change, with an audit event in this transaction.
-- Original content and all antecedents/attachment copies remain immutable.
CREATE OR REPLACE FUNCTION private.retention_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='retentionDocuments' AND TG_OP='UPDATE' THEN
    IF OLD.status IN ('registrada','historico') AND NEW.status='anulada' AND
      (to_jsonb(NEW)-ARRAY['status','voidedAt','voidedById','voidReason','reversalId']) =
      (to_jsonb(OLD)-ARRAY['status','voidedAt','voidedById','voidReason','reversalId']) AND
      EXISTS (SELECT 1 FROM "invoiceAccountingReversals" r JOIN users u ON u.id=r."actorId"
        WHERE r.id=NEW."reversalId" AND r."invoiceId"=OLD."invoiceId"
          AND r."transactionId"=txid_current() AND u."isActive" AND u.role='admin'
          AND lower(btrim(u.email))='ed_barah@hotmail.com'
          AND NEW."voidedById"=r."actorId" AND NEW."voidReason"=r.reason
          AND NEW."voidedAt"=r."createdAt") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'El comprobante o antecedente de retención está cerrado' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS iar_immutable ON "invoiceAccountingReversals";
CREATE TRIGGER iar_immutable BEFORE UPDATE OR DELETE ON "invoiceAccountingReversals"
  FOR EACH ROW EXECUTE FUNCTION private.retention_immutable();

CREATE OR REPLACE FUNCTION private.closed_invoice_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.status='registrada' THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'La factura contabilizada está cerrada' USING ERRCODE='23514';
    END IF;
    IF NEW.status='pendiente_contabilizar' AND NEW."accountedAt" IS NULL AND
      NEW."accountedById" IS NULL AND NEW."accountingComment" IS NULL AND
      (to_jsonb(NEW)-ARRAY['status','accountedAt','accountedById','accountingComment',
        'submittedForAccountingAt','submittedForAccountingById','updatedAt']) =
      (to_jsonb(OLD)-ARRAY['status','accountedAt','accountedById','accountingComment',
        'submittedForAccountingAt','submittedForAccountingById','updatedAt']) AND
      EXISTS (SELECT 1 FROM "invoiceAccountingReversals" r JOIN users u ON u.id=r."actorId"
        WHERE r."invoiceId"=OLD.id AND r."transactionId"=txid_current()
          AND r."invoiceSnapshot"=to_jsonb(OLD) AND u."isActive" AND u.role='admin'
          AND lower(btrim(u.email))='ed_barah@hotmail.com'
          AND NEW."submittedForAccountingById"=r."actorId"
          AND NEW."submittedForAccountingAt"=r."createdAt" AND NEW."updatedAt"=r."createdAt") THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW)-ARRAY['netPayable','creditNoteTotal','debitNoteTotal','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['netPayable','creditNoteTotal','debitNoteTotal','updatedAt']) THEN
      RAISE EXCEPTION 'La factura contabilizada está cerrada; use la reversión autorizada' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

-- Invoker privileges: only the trusted backend/database owner can execute this.
-- Authorization and financial checks are repeated in PostgreSQL, under locks.
CREATE OR REPLACE FUNCTION private.revert_accounted_invoice(p_invoice_id integer, p_actor_id integer, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_invoice invoices%ROWTYPE; v_order integer; v_reversal integer;
  v_count integer; v_now timestamptz := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_actor_id AND "isActive" AND role='admin'
      AND lower(btrim(email))='ed_barah@hotmail.com') THEN
    RAISE EXCEPTION 'Reversión no autorizada' USING ERRCODE='BR001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Motivo inválido' USING ERRCODE='BR002';
  END IF;
  -- Same order as advances/accounting/payment writers: order -> advances -> invoice.
  SELECT "purchaseOrderId" INTO v_order FROM invoices WHERE id=p_invoice_id;
  PERFORM id FROM "purchaseOrders" WHERE id=v_order FOR UPDATE;
  PERFORM id FROM "purchaseOrderAdvances" WHERE "purchaseOrderId"=v_order ORDER BY id FOR UPDATE;
  SELECT * INTO v_invoice FROM invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada' USING ERRCODE='BR003'; END IF;
  IF v_invoice.status<>'registrada' THEN
    RAISE EXCEPTION 'La factura cambió de estado' USING ERRCODE='BR004';
  END IF;
  IF EXISTS (SELECT 1 FROM "treasuryPaymentItems" t JOIN "treasuryPaymentBatches" b ON b.id=t."batchId"
      WHERE (t."invoiceId"=p_invoice_id OR t."qualityRetentionReleaseId" IN (
        SELECT q.id FROM "qualityRetentionReleases" q JOIN "invoiceDocumentAdjustments" a
          ON a.id=q."invoiceDocumentAdjustmentId" WHERE a."invoiceId"=p_invoice_id))
      AND (t.status IN ('pagada','con_diferencia','contabilizada') OR coalesce(t."bankPaidAmount",0)>0
        OR (t."activeReservation" AND b.status<>'anulado'))) THEN
    RAISE EXCEPTION 'La factura tiene pagos o reservas' USING ERRCODE='BR005';
  END IF;
  IF EXISTS (SELECT 1 FROM "purchaseOrderAdvanceApplications" WHERE "invoiceId"=p_invoice_id)
      OR EXISTS (SELECT 1 FROM "invoiceContractualAmortizations" WHERE "invoiceId"=p_invoice_id) THEN
    RAISE EXCEPTION 'La factura tiene anticipos o amortización comprometida' USING ERRCODE='BR006';
  END IF;
  IF EXISTS (SELECT 1 FROM "financialNotes" n WHERE n.origin<>'retentions' AND n.status<>'anulada'
      AND n."deletedAt" IS NULL AND (n."sourceInvoiceId"=p_invoice_id OR n.id IN (
        SELECT "noteId" FROM "financialNoteInvoices" WHERE "invoiceId"=p_invoice_id))) THEN
    RAISE EXCEPTION 'La factura tiene notas activas' USING ERRCODE='BR007';
  END IF;
  IF EXISTS (SELECT 1 FROM "qualityRetentionReleases" q JOIN "invoiceDocumentAdjustments" a
      ON a.id=q."invoiceDocumentAdjustmentId" WHERE a."invoiceId"=p_invoice_id
      AND q.status NOT IN ('cancelled','rejected')) THEN
    RAISE EXCEPTION 'La factura tiene liberaciones de calidad activas' USING ERRCODE='BR008';
  END IF;
  IF EXISTS (SELECT 1 FROM "reverseLogistics" WHERE "sourceReceiptId"=v_invoice."receiptId"
      AND status<>'rechazada') THEN
    RAISE EXCEPTION 'La factura tiene devoluciones activas' USING ERRCODE='BR009';
  END IF;
  INSERT INTO "invoiceAccountingReversals" ("invoiceId","actorId",reason,"createdAt","invoiceSnapshot")
    VALUES (p_invoice_id,p_actor_id,btrim(p_reason),v_now,to_jsonb(v_invoice)) RETURNING id INTO v_reversal;
  UPDATE "retentionDocuments" SET status='anulada',"voidedAt"=v_now,"voidedById"=p_actor_id,
      "voidReason"=btrim(p_reason),"reversalId"=v_reversal
    WHERE "invoiceId"=p_invoice_id AND status IN ('registrada','historico');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE invoices SET status='pendiente_contabilizar',"accountedAt"=NULL,"accountedById"=NULL,
      "accountingComment"=NULL,"submittedForAccountingAt"=v_now,
      "submittedForAccountingById"=p_actor_id,"updatedAt"=v_now WHERE id=p_invoice_id;
  RETURN jsonb_build_object('id',p_invoice_id,'status','pendiente_contabilizar',
    'reversalId',v_reversal,'voidedRetentionCount',v_count);
END $$;
REVOKE ALL ON FUNCTION private.revert_accounted_invoice(integer,integer,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION private.revert_accounted_invoice(integer,integer,text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION private.revert_accounted_invoice(integer,integer,text) FROM authenticated;
  END IF;
END $$;

-- An audit event cannot be committed without the complete corresponding reversal.
CREATE OR REPLACE FUNCTION private.invoice_reversal_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id=NEW."invoiceId" AND status='pendiente_contabilizar'
      AND "accountedAt" IS NULL AND "accountedById" IS NULL
      AND "submittedForAccountingById"=NEW."actorId") OR
    EXISTS (SELECT 1 FROM "retentionDocuments" WHERE "invoiceId"=NEW."invoiceId"
      AND status IN ('registrada','historico')) THEN
    RAISE EXCEPTION 'La reversión contable debe completarse en una sola transacción' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_reversal_complete ON "invoiceAccountingReversals";
CREATE CONSTRAINT TRIGGER invoice_reversal_complete AFTER INSERT ON "invoiceAccountingReversals"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.invoice_reversal_complete();
