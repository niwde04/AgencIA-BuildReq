BEGIN;

ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'financial_note';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "creditNoteTotal" numeric(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "debitNoteTotal" numeric(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "reverseLogisticsItems" ADD COLUMN IF NOT EXISTS "sourceReceiptItemId" integer REFERENCES "receiptItems"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "financialNoteSettings" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "enabled" boolean NOT NULL DEFAULT true,
  "activatedAt" timestamptz NOT NULL DEFAULT now()
);
-- Never move the activation cutoff when this migration is replayed.
INSERT INTO "financialNoteSettings" ("id") VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "financialNoteConcepts" (
  "id" serial PRIMARY KEY,
  "type" varchar(10) NOT NULL CHECK ("type" IN ('credit','debit')),
  "code" varchar(64) NOT NULL,
  "description" varchar(500) NOT NULL,
  "applicability" text NOT NULL DEFAULT '',
  "financialGroupCode" varchar(20) REFERENCES "financialGroups"("financialGroupCode") ON UPDATE CASCADE ON DELETE RESTRICT,
  "retentionCatalogId" integer REFERENCES "taxRetentions"("id") ON DELETE RESTRICT,
  "isActive" boolean NOT NULL DEFAULT true,
  "allowsTaxOnly" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fnc_retention_check" CHECK ("retentionCatalogId" IS NULL OR "type" = 'credit')
);
CREATE UNIQUE INDEX IF NOT EXISTS "fnc_type_code_unique" ON "financialNoteConcepts" ("type", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "fnc_retention_unique" ON "financialNoteConcepts" ("retentionCatalogId");
CREATE INDEX IF NOT EXISTS "fnc_type_active_code_idx" ON "financialNoteConcepts" ("type", "isActive", "code");

CREATE TABLE IF NOT EXISTS "financialNoteSequences" (
  "id" serial PRIMARY KEY,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "type" varchar(10) NOT NULL CHECK ("type" IN ('credit','debit')),
  "lastValue" integer NOT NULL DEFAULT 0 CHECK ("lastValue" BETWEEN 0 AND 99999999)
);
CREATE UNIQUE INDEX IF NOT EXISTS "fns_project_type_unique" ON "financialNoteSequences" ("projectId", "type");

CREATE TABLE IF NOT EXISTS "financialNotes" (
  "id" serial PRIMARY KEY,
  "type" varchar(10) NOT NULL CHECK ("type" IN ('credit','debit')),
  "origin" varchar(20) NOT NULL DEFAULT 'manual',
  "documentNumber" varchar(64) NOT NULL UNIQUE,
  "requestKey" varchar(100) UNIQUE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "supplierId" integer NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "currency" varchar(3) NOT NULL CHECK ("currency" IN ('HNL','USD')),
  "status" varchar(15) NOT NULL DEFAULT 'borrador' CHECK ("status" IN ('borrador','revisada','rechazada','registrada','anulada')),
  "sourceInvoiceId" integer REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "sourceReturnId" integer REFERENCES "reverseLogistics"("id") ON DELETE RESTRICT,
  "cai" varchar(100), "fiscalNumber" varchar(100),
  "documentRangeStart" varchar(100), "documentRangeEnd" varchar(100),
  "documentDate" date, "documentDueDate" date, "emissionDeadline" date,
  "notes" text,
  "subtotal" numeric(14,4) NOT NULL DEFAULT 0,
  "taxAmount" numeric(14,4) NOT NULL DEFAULT 0,
  "total" numeric(14,4) NOT NULL DEFAULT 0,
  "createdById" integer NOT NULL REFERENCES "users"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deletedAt" timestamptz,
  CONSTRAINT "fn_total_check" CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "total" = "subtotal" + "taxAmount"),
  CONSTRAINT "fn_origin_check" CHECK (
    ("origin" = 'manual' AND "sourceInvoiceId" IS NULL AND "sourceReturnId" IS NULL) OR
    ("origin" = 'retentions' AND "type" = 'credit' AND "sourceInvoiceId" IS NOT NULL AND "sourceReturnId" IS NULL) OR
    ("origin" = 'supplier_return' AND "type" = 'credit' AND "sourceInvoiceId" IS NOT NULL AND "sourceReturnId" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "fn_type_project_created_idx" ON "financialNotes" ("type", "projectId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "fn_supplier_status_idx" ON "financialNotes" ("supplierId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "fn_supplier_type_fiscal_unique" ON "financialNotes" ("supplierId", "type", "fiscalNumber") WHERE "fiscalNumber" IS NOT NULL AND "fiscalNumber" <> '';
CREATE UNIQUE INDEX IF NOT EXISTS "fn_active_retention_invoice_unique" ON "financialNotes" ("sourceInvoiceId") WHERE "origin" = 'retentions' AND "status" <> 'anulada';
CREATE UNIQUE INDEX IF NOT EXISTS "fn_source_return_unique" ON "financialNotes" ("sourceReturnId");

CREATE TABLE IF NOT EXISTS "financialNoteLines" (
  "id" serial PRIMARY KEY,
  "noteId" integer NOT NULL REFERENCES "financialNotes"("id") ON DELETE CASCADE,
  "conceptId" integer NOT NULL REFERENCES "financialNoteConcepts"("id") ON DELETE RESTRICT,
  "code" varchar(64) NOT NULL, "description" varchar(500) NOT NULL,
  "financialGroupCode" varchar(20), "financialGroupDescription" varchar(500),
  "baseAmount" numeric(14,4) NOT NULL, "taxCode" varchar(50), "taxSnapshot" jsonb,
  "taxAmount" numeric(14,4) NOT NULL, "total" numeric(14,4) NOT NULL, "notes" text,
  CONSTRAINT "fnl_total_check" CHECK ("baseAmount" >= 0 AND "taxAmount" >= 0 AND "total" > 0 AND "total" = "baseAmount" + "taxAmount")
);
CREATE INDEX IF NOT EXISTS "fnl_note_idx" ON "financialNoteLines" ("noteId");
CREATE INDEX IF NOT EXISTS "fnl_concept_idx" ON "financialNoteLines" ("conceptId");
CREATE TABLE IF NOT EXISTS "financialNoteInvoices" (
  "id" serial PRIMARY KEY,
  "noteId" integer NOT NULL REFERENCES "financialNotes"("id") ON DELETE CASCADE,
  "invoiceId" integer NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "amount" numeric(14,4) NOT NULL CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "fni_note_invoice_unique" ON "financialNoteInvoices" ("noteId", "invoiceId");
CREATE INDEX IF NOT EXISTS "fni_invoice_idx" ON "financialNoteInvoices" ("invoiceId");
CREATE TABLE IF NOT EXISTS "financialNoteEvents" (
  "id" serial PRIMARY KEY,
  "noteId" integer NOT NULL REFERENCES "financialNotes"("id") ON DELETE RESTRICT,
  "actorId" integer NOT NULL REFERENCES "users"("id"),
  "action" varchar(40) NOT NULL, "comment" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fne_note_created_idx" ON "financialNoteEvents" ("noteId", "createdAt");

INSERT INTO "financialNoteConcepts" ("type","code","description","applicability","allowsTaxOnly") VALUES
('credit','NC-C01','Devolución de materiales','Cuando se devuelven materiales al proveedor por excedente, error de compra o cambio de necesidad',false),
('credit','NC-C02','Material defectuoso o dañado','Cuando el proveedor reconoce materiales con daño, defecto o calidad no conforme',false),
('credit','NC-C03','Material recibido incompleto','Cuando se facturó una cantidad mayor a la realmente entregada',false),
('credit','NC-C04','Error en cantidad facturada','Cuando la factura refleja más unidades de las solicitadas o recibidas',false),
('credit','NC-C05','Error en precio unitario','Cuando el proveedor facturó a un precio superior al acordado',false),
('credit','NC-C06','Descuento comercial posterior','Cuando el proveedor concede un descuento después de haber emitido la factura',false),
('credit','NC-C07','Descuento por volumen','Cuando se reconoce posteriormente un descuento por cantidad comprada',false),
('credit','NC-C08','Bonificación de proveedor','Cuando el proveedor concede una bonificación económica sobre compras realizadas',false),
('credit','NC-C09','Corrección de factura duplicada','Cuando una compra fue facturada dos veces',false),
('credit','NC-C10','Anulación total de factura de compra','Cuando la factura debe dejarse completamente sin efecto',false),
('credit','NC-C11','Corrección de impuesto','Cuando el proveedor corrige ISV u otro componente tributario facturado incorrectamente',true),
('credit','NC-C12','Corrección de flete o transporte','Cuando se cobró de más por transporte, acarreo, entrega o logística',false),
('credit','NC-C13','Corrección de cargos adicionales','Cuando se facturaron cargos no autorizados, como manejo, embalaje, instalación u otros',false),
('credit','NC-C14','Diferencia entre orden de compra y factura','Cuando la factura supera lo aprobado en la orden de compra',false),
('credit','NC-C15','Diferencia entre recepción y factura','Cuando lo facturado no coincide con la entrada de almacén o recepción física',false),
('credit','NC-C16','Rechazo parcial de materiales','Cuando una parte del suministro no cumple especificaciones y es rechazada',false),
('credit','NC-C17','Rechazo total del suministro','Cuando toda la entrega es rechazada y debe revertirse la compra',false),
('credit','NC-C18','Cambio de especificación de material','Cuando se devuelve o ajusta material porque no corresponde a la especificación aprobada',false),
('credit','NC-C19','Sustitución de producto','Cuando el proveedor reemplaza un producto por otro de menor valor y reconoce la diferencia',false),
('credit','NC-C20','Ajuste por faltante de entrega','Cuando existe diferencia entre factura y cantidad física recibida',false),
('credit','NC-C21','Ajuste por peso, volumen o medida','Frecuente en agregados, acero, concreto, combustible u otros materiales medidos por peso o volumen',false),
('credit','NC-C22','Ajuste por calidad o especificación','Cuando se acepta el producto, pero con una reducción de precio por no cumplir completamente las condiciones pactadas',false),
('credit','NC-C23','Penalización o compensación del proveedor','Cuando contractualmente el proveedor reconoce un crédito por incumplimiento, retraso u otra causa',false),
('credit','NC-C24','Corrección de anticipo a proveedor','Cuando debe corregirse un monto previamente facturado relacionado con un anticipo',false),
('credit','NC-C25','Ajuste de compra por conciliación con proveedor','Cuando después de revisar el estado de cuenta se identifica una diferencia a favor de la empresa',false),
('credit','NC-C26','Devolución de herramienta o equipo adquirido','Cuando se devuelve equipo, herramienta o activo facturado',false),
('credit','NC-C27','Corrección de alquiler de equipo','Cuando se facturaron días, horas o tarifas superiores a las realmente utilizadas',false),
('credit','NC-C28','Corrección de servicio contratado','Cuando un proveedor de servicios facturó trabajos no ejecutados o parcialmente ejecutados',false),
('credit','NC-C29','Reembolso de gastos facturados incorrectamente','Cuando el proveedor incluyó gastos que no correspondían',false),
('credit','NC-C30','Otros ajustes de compra autorizados','Para casos excepcionales debidamente documentados',false),
('debit','ND-C01','Diferencias de precio','Cuando corresponde aumentar el precio previamente facturado',false),
('debit','ND-C02','Diferencias de cantidad','Cuando deben reconocerse cantidades adicionales a las facturadas',false),
('debit','ND-C03','Corrección de impuesto','Cuando debe aumentarse el impuesto de una factura',true),
('debit','ND-C04','Ajuste de flete','Cuando corresponde reconocer un importe adicional de transporte',false),
('debit','ND-C05','Cargos adicionales','Para cargos adicionales autorizados relacionados con la factura',false),
('debit','ND-C06','Otros ajustes de compra','Para otros incrementos autorizados y documentados',false)
ON CONFLICT ("type","code") DO NOTHING;

INSERT INTO "financialNoteConcepts" ("type","code","description","applicability","retentionCatalogId","isActive")
SELECT 'credit','NC-' || "taxCode","description",coalesce("note",''),"id","isActive" FROM "taxRetentions"
ON CONFLICT DO NOTHING;

-- All business data is served by the trusted backend, never the Data API.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['financialNoteSettings','financialNoteConcepts','financialNoteSequences','financialNotes','financialNoteLines','financialNoteInvoices','financialNoteEvents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated', t);
    IF t <> 'financialNoteSettings' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM PUBLIC, anon, authenticated', t || '_id_seq');
    END IF;
  END LOOP;
END $$;

-- Prevent alternate invoice/receipt paths from invalidating accounted notes.
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.guard_invoice_financial_notes() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW."status" IS DISTINCT FROM OLD."status" AND OLD."status" = 'registrada')
     OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
     OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" THEN
    IF EXISTS (SELECT 1 FROM public."financialNoteInvoices" a JOIN public."financialNotes" n ON n.id = a."noteId"
       WHERE a."invoiceId" = OLD.id AND n.status = 'registrada') THEN
      RAISE EXCEPTION 'Anule las notas contabilizadas antes de corregir o anular la factura.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_invoice_financial_notes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS "guard_invoice_financial_notes" ON "invoices";
CREATE TRIGGER "guard_invoice_financial_notes" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_financial_notes();

COMMIT;
