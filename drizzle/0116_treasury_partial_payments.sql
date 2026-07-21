DO $$ BEGIN
  CREATE TYPE "treasury_batch_status" AS ENUM (
    'borrador',
    'enviado_depuracion',
    'pendiente_aprobacion',
    'aprobado',
    'enviado_banco',
    'conciliacion',
    'pendiente_contabilizacion',
    'cerrado',
    'devuelto',
    'anulado'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "treasury_item_status" AS ENUM (
    'incluida',
    'excluida',
    'aprobada',
    'pagada',
    'rechazada_banco',
    'con_diferencia',
    'contabilizada'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "attachment_entity_type"
  ADD VALUE IF NOT EXISTS 'treasury_payment_batch';
ALTER TYPE "attachment_category"
  ADD VALUE IF NOT EXISTS 'archivo_bancario';
ALTER TYPE "attachment_category"
  ADD VALUE IF NOT EXISTS 'comprobante_pago';
ALTER TYPE "notification_type"
  ADD VALUE IF NOT EXISTS 'tesoreria';

ALTER TABLE "systemSettings"
  ADD COLUMN IF NOT EXISTS "treasuryEnabled" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "treasuryApproverAssignments" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "isActive" boolean DEFAULT true NOT NULL,
  "assignedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "treasury_approver_user_unique"
  ON "treasuryApproverAssignments" ("userId");
CREATE INDEX IF NOT EXISTS "treasury_approver_active_idx"
  ON "treasuryApproverAssignments" ("isActive");

CREATE TABLE IF NOT EXISTS "treasuryPaymentBatches" (
  "id" serial PRIMARY KEY,
  "batchNumber" varchar(64) NOT NULL UNIQUE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "currency" varchar(3) NOT NULL,
  "requestedPaymentDate" date NOT NULL,
  "status" "treasury_batch_status" DEFAULT 'borrador' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "notes" text,
  "createdById" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "submittedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "submittedAt" timestamp,
  "purifiedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "purifiedAt" timestamp,
  "approvedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "approvedAt" timestamp,
  "exportedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "exportedAt" timestamp,
  "reconciledById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reconciledAt" timestamp,
  "accountedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "accountedAt" timestamp,
  "returnedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "returnedAt" timestamp,
  "returnReason" text,
  "cancelledById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "cancelledAt" timestamp,
  "cancellationReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "treasury_batch_currency_check" CHECK ("currency" IN ('HNL', 'USD')),
  CONSTRAINT "treasury_batch_version_check" CHECK ("version" > 0)
);

CREATE INDEX IF NOT EXISTS "treasury_batch_project_idx"
  ON "treasuryPaymentBatches" ("projectId");
CREATE INDEX IF NOT EXISTS "treasury_batch_status_idx"
  ON "treasuryPaymentBatches" ("status");
CREATE INDEX IF NOT EXISTS "treasury_batch_created_idx"
  ON "treasuryPaymentBatches" ("createdAt" DESC, "id" DESC);

CREATE TABLE IF NOT EXISTS "treasuryPaymentItems" (
  "id" serial PRIMARY KEY,
  "batchId" integer NOT NULL REFERENCES "treasuryPaymentBatches"("id") ON DELETE CASCADE,
  "invoiceId" integer NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "supplierId" integer REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "supplierCode" varchar(50) NOT NULL,
  "supplierName" varchar(500) NOT NULL,
  "invoiceDocumentNumber" varchar(64) NOT NULL,
  "invoiceNumber" varchar(100),
  "currency" varchar(3) NOT NULL,
  "invoiceNetPayable" numeric(14,4) NOT NULL,
  "previousPaidAmount" numeric(14,4) DEFAULT 0 NOT NULL,
  "requestedAmount" numeric(14,4) NOT NULL,
  "approvedAmount" numeric(14,4),
  "bankPaidAmount" numeric(14,4),
  "status" "treasury_item_status" DEFAULT 'incluida' NOT NULL,
  "activeReservation" boolean DEFAULT true NOT NULL,
  "bankPaidDate" date,
  "bankReference" varchar(255),
  "bankComment" text,
  "exclusionReason" text,
  "excludedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "excludedAt" timestamp,
  "differenceResolutionComment" text,
  "accountingComment" text,
  "accountedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "accountedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "treasury_item_currency_check" CHECK ("currency" IN ('HNL', 'USD')),
  CONSTRAINT "treasury_item_amount_check" CHECK ("requestedAmount" > 0 AND "invoiceNetPayable" > 0)
);

CREATE INDEX IF NOT EXISTS "treasury_item_batch_idx"
  ON "treasuryPaymentItems" ("batchId");
CREATE INDEX IF NOT EXISTS "treasury_item_invoice_idx"
  ON "treasuryPaymentItems" ("invoiceId");
CREATE INDEX IF NOT EXISTS "treasury_item_status_idx"
  ON "treasuryPaymentItems" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "treasury_item_batch_invoice_unique"
  ON "treasuryPaymentItems" ("batchId", "invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "treasury_item_active_invoice_unique"
  ON "treasuryPaymentItems" ("invoiceId")
  WHERE "activeReservation" = true;

CREATE TABLE IF NOT EXISTS "treasuryPaymentEvents" (
  "id" serial PRIMARY KEY,
  "batchId" integer NOT NULL REFERENCES "treasuryPaymentBatches"("id") ON DELETE CASCADE,
  "itemId" integer REFERENCES "treasuryPaymentItems"("id") ON DELETE CASCADE,
  "action" varchar(80) NOT NULL,
  "previousStatus" varchar(50),
  "newStatus" varchar(50),
  "actorUserId" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "actorName" varchar(255) NOT NULL,
  "actorRole" varchar(80) NOT NULL,
  "comment" text,
  "metadata" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "treasury_event_batch_date_idx"
  ON "treasuryPaymentEvents" ("batchId", "createdAt");
CREATE INDEX IF NOT EXISTS "treasury_event_item_idx"
  ON "treasuryPaymentEvents" ("itemId");
CREATE INDEX IF NOT EXISTS "treasury_event_actor_idx"
  ON "treasuryPaymentEvents" ("actorUserId");

ALTER TABLE "treasuryApproverAssignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treasuryPaymentBatches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treasuryPaymentItems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treasuryPaymentEvents" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "treasuryApproverAssignments" FROM anon, authenticated;
REVOKE ALL ON TABLE "treasuryPaymentBatches" FROM anon, authenticated;
REVOKE ALL ON TABLE "treasuryPaymentItems" FROM anon, authenticated;
REVOKE ALL ON TABLE "treasuryPaymentEvents" FROM anon, authenticated;
