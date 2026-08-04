CREATE TABLE IF NOT EXISTS "purchaseOrderDigitalSeals" (
  "id" serial PRIMARY KEY NOT NULL,
  "purchaseOrderId" integer NOT NULL REFERENCES "purchaseOrders"("id") ON DELETE RESTRICT,
  "approvalHistoryId" integer REFERENCES "procurementApprovalHistory"("id") ON DELETE RESTRICT,
  "sealType" varchar(40) NOT NULL,
  "signerUserId" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "signerName" varchar(255) NOT NULL,
  "signerRole" varchar(80) NOT NULL,
  "totalAmount" numeric(18, 2) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "signedAt" timestamp NOT NULL,
  "sealedAt" timestamp DEFAULT now() NOT NULL,
  "verificationTokenHash" varchar(64) NOT NULL,
  "verificationCode" varchar(20) NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  "officialPdfHash" varchar(64) NOT NULL,
  "invalidatedAt" timestamp,
  "invalidatedByUserId" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  "invalidationReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "po_digital_seal_type_check"
    CHECK ("sealType" IN ('approval', 'issued_without_approval')),
  CONSTRAINT "po_digital_seal_currency_check"
    CHECK ("currency" IN ('HNL', 'USD')),
  CONSTRAINT "po_digital_seal_token_hash_check"
    CHECK ("verificationTokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "po_digital_seal_payload_hash_check"
    CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "po_digital_seal_pdf_hash_check"
    CHECK ("officialPdfHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "po_digital_seal_order_uidx"
  ON "purchaseOrderDigitalSeals" ("purchaseOrderId");

CREATE UNIQUE INDEX IF NOT EXISTS "po_digital_seal_token_hash_uidx"
  ON "purchaseOrderDigitalSeals" ("verificationTokenHash");

CREATE UNIQUE INDEX IF NOT EXISTS "po_digital_seal_verification_code_uidx"
  ON "purchaseOrderDigitalSeals" ("verificationCode");

CREATE INDEX IF NOT EXISTS "po_digital_seal_approval_history_idx"
  ON "purchaseOrderDigitalSeals" ("approvalHistoryId");

CREATE INDEX IF NOT EXISTS "po_digital_seal_signer_user_idx"
  ON "purchaseOrderDigitalSeals" ("signerUserId");

CREATE INDEX IF NOT EXISTS "po_digital_seal_invalidated_by_idx"
  ON "purchaseOrderDigitalSeals" ("invalidatedByUserId");

CREATE OR REPLACE FUNCTION "protectPurchaseOrderDigitalSeal"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los sellos electrónicos de órdenes de compra no se pueden eliminar';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."purchaseOrderId" IS DISTINCT FROM OLD."purchaseOrderId"
    OR NEW."approvalHistoryId" IS DISTINCT FROM OLD."approvalHistoryId"
    OR NEW."sealType" IS DISTINCT FROM OLD."sealType"
    OR NEW."signerUserId" IS DISTINCT FROM OLD."signerUserId"
    OR NEW."signerName" IS DISTINCT FROM OLD."signerName"
    OR NEW."signerRole" IS DISTINCT FROM OLD."signerRole"
    OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
    OR NEW."sealedAt" IS DISTINCT FROM OLD."sealedAt"
    OR NEW."verificationTokenHash" IS DISTINCT FROM OLD."verificationTokenHash"
    OR NEW."verificationCode" IS DISTINCT FROM OLD."verificationCode"
    OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
    OR NEW."officialPdfHash" IS DISTINCT FROM OLD."officialPdfHash"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'El contenido del sello electrónico es inmutable';
  END IF;

  IF OLD."invalidatedAt" IS NOT NULL THEN
    IF NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt"
      OR NEW."invalidatedByUserId" IS DISTINCT FROM OLD."invalidatedByUserId"
      OR NEW."invalidationReason" IS DISTINCT FROM OLD."invalidationReason"
    THEN
      RAISE EXCEPTION 'La anulación de un sello electrónico es inmutable';
    END IF;
  ELSIF NEW."invalidatedAt" IS NOT NULL AND (
    NEW."invalidatedByUserId" IS NULL
    OR NULLIF(BTRIM(NEW."invalidationReason"), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'La anulación del sello requiere usuario y motivo';
  ELSIF NEW."invalidatedAt" IS NULL AND (
    NEW."invalidatedByUserId" IS DISTINCT FROM OLD."invalidatedByUserId"
    OR NEW."invalidationReason" IS DISTINCT FROM OLD."invalidationReason"
  ) THEN
    RAISE EXCEPTION 'Los datos de anulación requieren una fecha de anulación';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "purchase_order_digital_seal_immutable" ON "purchaseOrderDigitalSeals";
CREATE TRIGGER "purchase_order_digital_seal_immutable"
BEFORE UPDATE OR DELETE ON "purchaseOrderDigitalSeals"
FOR EACH ROW
EXECUTE FUNCTION "protectPurchaseOrderDigitalSeal"();

CREATE OR REPLACE FUNCTION "protectSealedPurchaseOrderPdf"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchaseOrderDigitalSeals"
    WHERE "purchaseOrderId" = OLD."id"
  ) AND (
    NEW."printedDocumentName" IS DISTINCT FROM OLD."printedDocumentName"
    OR NEW."printedDocumentMimeType" IS DISTINCT FROM OLD."printedDocumentMimeType"
    OR NEW."printedDocumentContent" IS DISTINCT FROM OLD."printedDocumentContent"
    OR NEW."printedAt" IS DISTINCT FROM OLD."printedAt"
  ) THEN
    RAISE EXCEPTION 'El PDF oficial sellado de la orden de compra es inmutable';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "purchase_order_official_pdf_immutable" ON "purchaseOrders";
CREATE TRIGGER "purchase_order_official_pdf_immutable"
BEFORE UPDATE ON "purchaseOrders"
FOR EACH ROW
EXECUTE FUNCTION "protectSealedPurchaseOrderPdf"();

-- El sello contiene identidad y huellas internas. Nunca se expone mediante
-- la Data API; la consulta pública pasa exclusivamente por el servidor.
ALTER TABLE "purchaseOrderDigitalSeals" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "purchaseOrderDigitalSeals" FROM anon;
    REVOKE ALL ON SEQUENCE "purchaseOrderDigitalSeals_id_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "purchaseOrderDigitalSeals" FROM authenticated;
    REVOKE ALL ON SEQUENCE "purchaseOrderDigitalSeals_id_seq" FROM authenticated;
  END IF;
END
$$;
