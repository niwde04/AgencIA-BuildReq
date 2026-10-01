-- Apply transactionally, then run reclassifyRetentionDocuments before commit.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS "retentionDocuments" (
 id serial PRIMARY KEY, "invoiceId" integer REFERENCES invoices(id) ON DELETE RESTRICT,
 "legacyNoteId" integer UNIQUE REFERENCES "financialNotes"(id) ON DELETE RESTRICT,
 "projectId" integer NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 "supplierId" integer NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
 status varchar(15) NOT NULL, "documentNumber" varchar(100), currency varchar(3) NOT NULL,
 total numeric(14,4) NOT NULL, "documentDate" timestamp,
 "createdById" integer REFERENCES users(id) ON DELETE RESTRICT,
 "createdAt" timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL,
 CONSTRAINT rd_status_check CHECK(status IN ('registrada','historico')),
 CONSTRAINT rd_current_check CHECK(status <> 'registrada' OR ("invoiceId" IS NOT NULL AND "legacyNoteId" IS NULL AND total>0 AND "documentNumber" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS rd_current_invoice_unique ON "retentionDocuments" ("invoiceId") WHERE status='registrada';
CREATE INDEX IF NOT EXISTS rd_date_page_idx ON "retentionDocuments" ("documentDate" DESC,id DESC);
CREATE INDEX IF NOT EXISTS rd_supplier_idx ON "retentionDocuments" ("supplierId",id);
CREATE INDEX IF NOT EXISTS rd_project_idx ON "retentionDocuments" ("projectId",id);
CREATE TABLE IF NOT EXISTS "retentionDocumentAntecedents" (
 "noteId" integer PRIMARY KEY REFERENCES "financialNotes"(id) ON DELETE RESTRICT,
 "documentId" integer NOT NULL REFERENCES "retentionDocuments"(id) ON DELETE RESTRICT, snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS rda_document_idx ON "retentionDocumentAntecedents" ("documentId");
CREATE TABLE IF NOT EXISTS "retentionDocumentAttachments" (
 id serial PRIMARY KEY, "documentId" integer NOT NULL REFERENCES "retentionDocuments"(id) ON DELETE RESTRICT,
 "attachmentId" integer NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
 "legacyNoteId" integer REFERENCES "financialNotes"(id) ON DELETE RESTRICT, snapshot jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rdatt_link_unique ON "retentionDocumentAttachments" ("documentId","attachmentId");
CREATE INDEX IF NOT EXISTS rdatt_attachment_idx ON "retentionDocumentAttachments" ("attachmentId");

CREATE OR REPLACE FUNCTION private.retention_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'El comprobante o antecedente de retención está cerrado' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['retentionDocuments','retentionDocumentAntecedents','retentionDocumentAttachments'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS retention_immutable ON %I',t);
  EXECUTE format('CREATE TRIGGER retention_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION private.retention_immutable()',t);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',t); END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['retentionDocuments_id_seq','retentionDocumentAttachments_id_seq'] LOOP
  EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM authenticated',t); END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.closed_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.status='registrada' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'La factura contabilizada está cerrada' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['netPayable','creditNoteTotal','debitNoteTotal','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['netPayable','creditNoteTotal','debitNoteTotal','updatedAt']) THEN
   RAISE EXCEPTION 'La factura contabilizada está cerrada; no puede volver a revisión ni modificarse' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS closed_invoice_guard ON invoices;
CREATE TRIGGER closed_invoice_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION private.closed_invoice_guard();

CREATE OR REPLACE FUNCTION private.closed_invoice_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_id integer; new_id integer; r record;
BEGIN
 IF TG_OP<>'INSERT' THEN old_id=OLD."invoiceId"; END IF;
 IF TG_OP<>'DELETE' THEN new_id=NEW."invoiceId"; END IF;
 FOR r IN SELECT id,status FROM invoices WHERE id IN (old_id,new_id) ORDER BY id FOR UPDATE LOOP
  IF r.status='registrada' THEN RAISE EXCEPTION 'Las líneas de una factura contabilizada están cerradas' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['invoiceRetentions','invoiceItems','invoiceDocumentAdjustments'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS closed_invoice_child_guard ON %I',t);
  EXECUTE format('CREATE TRIGGER closed_invoice_child_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION private.closed_invoice_child_guard()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.legacy_retention_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_id integer; new_id integer;
BEGIN
 IF TG_TABLE_NAME='financialNotes' THEN
  IF (TG_OP<>'INSERT' AND OLD.origin='retentions') OR (TG_OP<>'DELETE' AND NEW.origin='retentions') THEN
   RAISE EXCEPTION 'Las notas de retención son antecedentes cerrados' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN old_id=OLD."noteId"; END IF;
  IF TG_OP<>'DELETE' THEN new_id=NEW."noteId"; END IF;
  IF EXISTS(SELECT 1 FROM "financialNotes" WHERE id IN (old_id,new_id) AND origin='retentions') THEN
   RAISE EXCEPTION 'El antecedente de retención está cerrado' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['financialNotes','financialNoteLines','financialNoteInvoices','financialNoteEvents'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS legacy_retention_guard ON %I',t);
  EXECUTE format('CREATE TRIGGER legacy_retention_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION private.legacy_retention_guard()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.retention_attachment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r record; source jsonb;
BEGIN
 FOR source IN SELECT x FROM unnest(ARRAY[
  CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,
  CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END]) x WHERE x IS NOT NULL LOOP
  IF source->>'entityType'='invoice' THEN
   SELECT status INTO r FROM invoices WHERE id=(source->>'entityId')::integer FOR UPDATE;
   IF r.status='registrada' THEN RAISE EXCEPTION 'Los adjuntos de la factura contabilizada están cerrados' USING ERRCODE='23514'; END IF;
  ELSIF source->>'entityType'='financial_note' AND EXISTS(SELECT 1 FROM "financialNotes" WHERE id=(source->>'entityId')::integer AND origin='retentions') THEN
   RAISE EXCEPTION 'Los adjuntos del antecedente están cerrados' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM "retentionDocumentAttachments" WHERE "attachmentId"=OLD.id) THEN
  RAISE EXCEPTION 'Debe conservarse el soporte de retención' USING ERRCODE='23514';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS retention_attachment_guard ON attachments;
CREATE TRIGGER retention_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION private.retention_attachment_guard();

CREATE OR REPLACE FUNCTION private.accounted_retention_required() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='registrada' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  IF (SELECT coalesce(sum(amount),0) FROM "invoiceRetentions" WHERE "invoiceId"=NEW.id) <> NEW."retentionTotal" THEN
   RAISE EXCEPTION 'La suma de las retenciones no coincide con la factura' USING ERRCODE='23514';
  END IF;
  IF NEW."retentionTotal">0 AND NOT EXISTS(SELECT 1 FROM "retentionDocuments" WHERE "invoiceId"=NEW.id AND status='registrada' AND total=NEW."retentionTotal") THEN
   RAISE EXCEPTION 'La contabilización requiere su comprobante de retención' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounted_retention_required ON invoices;
CREATE CONSTRAINT TRIGGER accounted_retention_required AFTER INSERT OR UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.accounted_retention_required();
