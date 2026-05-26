ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'supplier';

DO $$ BEGIN
  CREATE TYPE "supplier_document_expiration_mode" AS ENUM ('required', 'optional', 'none');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "supplierDocumentTypes" (
  "id" serial PRIMARY KEY,
  "code" varchar(80) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "expirationMode" "supplier_document_expiration_mode" NOT NULL DEFAULT 'optional',
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "sup_doc_type_code_idx"
  ON "supplierDocumentTypes" ("code");

CREATE INDEX IF NOT EXISTS "sup_doc_type_active_idx"
  ON "supplierDocumentTypes" ("isActive");

CREATE TABLE IF NOT EXISTS "supplierDocuments" (
  "id" serial PRIMARY KEY,
  "supplierId" integer NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "documentTypeId" integer NOT NULL REFERENCES "supplierDocumentTypes"("id"),
  "attachmentId" integer NOT NULL UNIQUE REFERENCES "attachments"("id") ON DELETE CASCADE,
  "documentDate" timestamp NOT NULL,
  "expirationDate" timestamp,
  "description" text,
  "createdById" integer NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sup_doc_supplier_idx"
  ON "supplierDocuments" ("supplierId");

CREATE INDEX IF NOT EXISTS "sup_doc_type_idx"
  ON "supplierDocuments" ("documentTypeId");

CREATE UNIQUE INDEX IF NOT EXISTS "sup_doc_attachment_idx"
  ON "supplierDocuments" ("attachmentId");

INSERT INTO "supplierDocumentTypes"
  ("code", "name", "description", "expirationMode", "isActive")
VALUES
  ('constancia_pago_a_cuenta', 'Constancia de pagos a cuenta', 'Constancia fiscal vigente del proveedor.', 'required', true),
  ('contrato', 'Contrato', 'Contrato o convenio asociado al proveedor.', 'required', true),
  ('rtn', 'RTN', 'Registro tributario nacional del proveedor.', 'none', true),
  ('otro', 'Otro', 'Documento adicional del proveedor.', 'optional', true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "expirationMode" = EXCLUDED."expirationMode",
  "isActive" = true,
  "updatedAt" = now();
