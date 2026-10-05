-- Apply transactionally after 20260930120000_retention_documents.sql.
-- Printing creates a normal registered retention; accounting freezes its snapshot.
CREATE OR REPLACE FUNCTION private.retention_document_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE source record;
BEGIN
  -- Preserve the existing audited cancellation authorized by invoice reversal.
  IF TG_OP='UPDATE' AND NEW.status='anulada' THEN
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
  IF TG_OP<>'INSERT' AND (OLD.status IN ('historico','anulada') OR OLD.snapshot->>'accountedAt' IS NOT NULL) THEN
    RAISE EXCEPTION 'El comprobante o antecedente de retención está cerrado' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.status='historico' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'No se puede cambiar el origen del comprobante de retención' USING ERRCODE='23514';
  END IF;
  SELECT status,"projectId","supplierId","retentionTotal","retentionReceiptNumber","accountedAt","accountedById" INTO source
    FROM invoices WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END FOR UPDATE;
  IF TG_OP='DELETE' THEN
    IF source.status='registrada' AND source."retentionTotal">0 THEN
      RAISE EXCEPTION 'La factura contabilizada requiere su comprobante' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT FOUND OR NEW.status<>'registrada'
    OR NEW."projectId" IS DISTINCT FROM source."projectId" OR NEW."supplierId" IS DISTINCT FROM source."supplierId"
    OR NEW.total IS DISTINCT FROM source."retentionTotal" OR NEW."documentNumber" IS DISTINCT FROM source."retentionReceiptNumber"
    OR source.status NOT IN ('borrador','rechazada','revisada','pendiente_contabilizar','registrada') THEN
    RAISE EXCEPTION 'El comprobante debe coincidir con la factura y su estado' USING ERRCODE='23514';
  END IF;
  IF source.status='registrada' THEN
    IF source."accountedAt" IS NULL OR source."accountedById" IS NULL
      -- Legacy producers interpreted the timezone-free column as Honduras local time.
      OR ((NEW.snapshot->>'accountedAt')::timestamptz IS DISTINCT FROM (date_trunc('milliseconds', source."accountedAt") AT TIME ZONE 'UTC')
        AND (NEW.snapshot->>'accountedAt')::timestamptz IS DISTINCT FROM (date_trunc('milliseconds', source."accountedAt") AT TIME ZONE 'America/Tegucigalpa'))
      OR (NEW.snapshot->>'accountedById')::integer IS DISTINCT FROM source."accountedById" THEN
      RAISE EXCEPTION 'El comprobante debe conservar la contabilización de la factura' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.snapshot->>'accountedAt' IS NOT NULL OR NEW.snapshot->>'accountedById' IS NOT NULL THEN
    RAISE EXCEPTION 'La factura todavía no está contabilizada; revise su estado' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS retention_immutable ON "retentionDocuments";
DROP TRIGGER IF EXISTS retention_document_guard ON "retentionDocuments";
CREATE TRIGGER retention_document_guard BEFORE INSERT OR UPDATE OR DELETE ON "retentionDocuments"
  FOR EACH ROW EXECUTE FUNCTION private.retention_document_guard();

CREATE OR REPLACE FUNCTION private.accounted_retention_required() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.status='registrada' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF (SELECT coalesce(sum(amount),0) FROM "invoiceRetentions" WHERE "invoiceId"=NEW.id) <> NEW."retentionTotal" THEN
      RAISE EXCEPTION 'La suma de las retenciones no coincide con la factura' USING ERRCODE='23514';
    END IF;
    IF NEW."retentionTotal">0 AND NOT EXISTS(
      SELECT 1 FROM "retentionDocuments" WHERE "invoiceId"=NEW.id AND status='registrada' AND total=NEW."retentionTotal"
        AND (snapshot->>'accountedAt')::timestamptz IN (
          date_trunc('milliseconds', NEW."accountedAt") AT TIME ZONE 'UTC',
          date_trunc('milliseconds', NEW."accountedAt") AT TIME ZONE 'America/Tegucigalpa')
        AND (snapshot->>'accountedById')::integer = NEW."accountedById") THEN
      RAISE EXCEPTION 'La contabilización requiere su comprobante de retención cerrado' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
