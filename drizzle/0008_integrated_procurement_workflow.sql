ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS 'administrador_proyecto';
ALTER TYPE "recipient" ADD VALUE IF NOT EXISTS 'bodega_proyecto';
ALTER TYPE "recipient" ADD VALUE IF NOT EXISTS 'oficina_central';
ALTER TYPE "request_status" ADD VALUE IF NOT EXISTS 'anulada';
ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'purchase_request';
ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'purchase_order';
ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'transfer_request';
ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'receipt';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'orden_compra';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'traslado';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'recepcion';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_type') THEN
    CREATE TYPE "request_type" AS ENUM ('bienes', 'servicios');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_workflow_stage') THEN
    CREATE TYPE "request_workflow_stage" AS ENUM (
      'bodega_proyecto',
      'administrador_proyecto',
      'oficina_central',
      'compra_local',
      'compra_internacional',
      'traslado',
      'recepcion',
      'cerrada',
      'rechazada'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status') THEN
    CREATE TYPE "approval_status" AS ENUM ('pendiente', 'aprobada', 'rechazada', 'no_requiere');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_request_status') THEN
    CREATE TYPE "purchase_request_status" AS ENUM (
      'pendiente',
      'en_revision',
      'aprobada',
      'rechazada',
      'parcialmente_convertida',
      'convertida',
      'anulada'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_classification') THEN
    CREATE TYPE "purchase_order_classification" AS ENUM ('oc', 'cd');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE "purchase_order_status" AS ENUM (
      'borrador',
      'emitida',
      'enviada',
      'parcialmente_recibida',
      'recibida',
      'anulada'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_delivery_status') THEN
    CREATE TYPE "document_delivery_status" AS ENUM ('pendiente', 'enviado', 'fallido');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_destination_type') THEN
    CREATE TYPE "transfer_destination_type" AS ENUM ('proyecto', 'bodega_central');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_request_status') THEN
    CREATE TYPE "transfer_request_status" AS ENUM ('pendiente', 'aprobada', 'rechazada', 'convertida', 'anulada');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_status') THEN
    CREATE TYPE "transfer_status" AS ENUM (
      'pendiente',
      'confirmado',
      'en_transito',
      'parcialmente_recibido',
      'recibido',
      'anulado'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_status') THEN
    CREATE TYPE "receipt_status" AS ENUM ('pendiente', 'parcial', 'completa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_source_type') THEN
    CREATE TYPE "receipt_source_type" AS ENUM ('purchase_order', 'transfer');
  END IF;
END $$;

ALTER TABLE "materialRequests" ADD COLUMN IF NOT EXISTS "requestType" "request_type" DEFAULT 'bienes' NOT NULL;
ALTER TABLE "materialRequests" ADD COLUMN IF NOT EXISTS "workflowStage" "request_workflow_stage" DEFAULT 'bodega_proyecto' NOT NULL;
ALTER TABLE "materialRequests" ADD COLUMN IF NOT EXISTS "approvalStatus" "approval_status" DEFAULT 'no_requiere' NOT NULL;
ALTER TABLE "materialRequests" ADD COLUMN IF NOT EXISTS "rejectionReason" text;
ALTER TABLE "materialRequests" ADD COLUMN IF NOT EXISTS "approvedById" integer;
ALTER TABLE "materialRequests" ADD COLUMN IF NOT EXISTS "approvedAt" timestamp;

ALTER TABLE "materialRequests"
  ALTER COLUMN "recipient" SET DEFAULT 'bodega_proyecto';

UPDATE "materialRequests"
SET
  "requestType" = COALESCE("requestType", 'bienes'),
  "workflowStage" = CASE
    WHEN COALESCE("requestType", 'bienes') = 'servicios' THEN 'administrador_proyecto'
    ELSE 'bodega_proyecto'
  END,
  "approvalStatus" = CASE
    WHEN COALESCE("requestType", 'bienes') = 'servicios' THEN 'pendiente'
    ELSE 'no_requiere'
  END,
  "recipient" = CASE
    WHEN COALESCE("requestType", 'bienes') = 'servicios' THEN 'administrador_proyecto'
    ELSE 'bodega_proyecto'
  END
WHERE "workflowStage" IS NULL OR "approvalStatus" IS NULL OR "recipient" IS NULL;

ALTER TABLE "requestItems" ADD COLUMN IF NOT EXISTS "dispatchedQuantity" decimal(12,2);
ALTER TABLE "requestItems" ADD COLUMN IF NOT EXISTS "committedQuantity" decimal(12,2);
ALTER TABLE "requestItems" ADD COLUMN IF NOT EXISTS "projectStock" decimal(12,2);
ALTER TABLE "requestItems" ADD COLUMN IF NOT EXISTS "sapStock" decimal(12,2);
ALTER TABLE "requestItems" ADD COLUMN IF NOT EXISTS "warehouseExitNote" text;

ALTER TABLE "inventoryItems" ADD COLUMN IF NOT EXISTS "projectId" integer;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "email" varchar(320);

CREATE INDEX IF NOT EXISTS "inv_project_idx" ON "inventoryItems" USING btree ("projectId");

CREATE TABLE IF NOT EXISTS "purchaseRequests" (
  "id" serial PRIMARY KEY NOT NULL,
  "requestNumber" varchar(20) NOT NULL UNIQUE,
  "materialRequestId" integer,
  "projectId" integer NOT NULL,
  "createdById" integer NOT NULL,
  "purchaseType" "purchase_type" NOT NULL,
  "status" "purchase_request_status" DEFAULT 'pendiente' NOT NULL,
  "neededBy" timestamp,
  "sapDocumentNumber" varchar(50),
  "notes" text,
  "rejectionReason" text,
  "printedDocumentName" varchar(255),
  "printedDocumentMimeType" varchar(100),
  "printedDocumentContent" text,
  "printedAt" timestamp,
  "quoteAttachmentId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "pr_project_idx" ON "purchaseRequests" USING btree ("projectId");
CREATE INDEX IF NOT EXISTS "pr_material_request_idx" ON "purchaseRequests" USING btree ("materialRequestId");
CREATE INDEX IF NOT EXISTS "pr_status_idx" ON "purchaseRequests" USING btree ("status");

CREATE TABLE IF NOT EXISTS "purchaseRequestItems" (
  "id" serial PRIMARY KEY NOT NULL,
  "purchaseRequestId" integer NOT NULL,
  "materialRequestItemId" integer,
  "originalSapItemCode" varchar(50),
  "currentSapItemCode" varchar(50),
  "itemName" varchar(500) NOT NULL,
  "quantity" decimal(12,2) NOT NULL,
  "receivedQuantity" decimal(12,2),
  "unit" varchar(50),
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "pri_purchase_request_idx" ON "purchaseRequestItems" USING btree ("purchaseRequestId");

CREATE TABLE IF NOT EXISTS "purchaseOrders" (
  "id" serial PRIMARY KEY NOT NULL,
  "orderNumber" varchar(20) NOT NULL UNIQUE,
  "purchaseRequestId" integer,
  "projectId" integer NOT NULL,
  "classification" "purchase_order_classification" DEFAULT 'oc' NOT NULL,
  "purchaseType" "purchase_type",
  "supplierId" integer,
  "supplierEmail" varchar(320),
  "status" "purchase_order_status" DEFAULT 'borrador' NOT NULL,
  "neededBy" timestamp,
  "sapDocumentNumber" varchar(50),
  "notes" text,
  "printedDocumentName" varchar(255),
  "printedDocumentMimeType" varchar(100),
  "printedDocumentContent" text,
  "printedAt" timestamp,
  "emailStatus" "document_delivery_status" DEFAULT 'pendiente' NOT NULL,
  "emailedAt" timestamp,
  "emailError" text,
  "createdById" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "po_purchase_request_idx" ON "purchaseOrders" USING btree ("purchaseRequestId");
CREATE INDEX IF NOT EXISTS "po_project_idx" ON "purchaseOrders" USING btree ("projectId");
CREATE INDEX IF NOT EXISTS "po_status_idx" ON "purchaseOrders" USING btree ("status");

CREATE TABLE IF NOT EXISTS "purchaseOrderItems" (
  "id" serial PRIMARY KEY NOT NULL,
  "purchaseOrderId" integer NOT NULL,
  "purchaseRequestItemId" integer,
  "materialRequestItemId" integer,
  "originalSapItemCode" varchar(50),
  "currentSapItemCode" varchar(50),
  "itemName" varchar(500) NOT NULL,
  "quantity" decimal(12,2) NOT NULL,
  "receivedQuantity" decimal(12,2),
  "unit" varchar(50),
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "poi_purchase_order_idx" ON "purchaseOrderItems" USING btree ("purchaseOrderId");

CREATE TABLE IF NOT EXISTS "transferRequests" (
  "id" serial PRIMARY KEY NOT NULL,
  "requestNumber" varchar(20) NOT NULL UNIQUE,
  "materialRequestId" integer,
  "projectId" integer NOT NULL,
  "destinationType" "transfer_destination_type" NOT NULL,
  "destinationProjectId" integer,
  "createdById" integer NOT NULL,
  "status" "transfer_request_status" DEFAULT 'pendiente' NOT NULL,
  "neededBy" timestamp,
  "notes" text,
  "rejectionReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tr_project_idx" ON "transferRequests" USING btree ("projectId");
CREATE INDEX IF NOT EXISTS "tr_material_request_idx" ON "transferRequests" USING btree ("materialRequestId");
CREATE INDEX IF NOT EXISTS "tr_status_idx" ON "transferRequests" USING btree ("status");

CREATE TABLE IF NOT EXISTS "transferRequestItems" (
  "id" serial PRIMARY KEY NOT NULL,
  "transferRequestId" integer NOT NULL,
  "materialRequestItemId" integer,
  "itemName" varchar(500) NOT NULL,
  "sapItemCode" varchar(50),
  "quantity" decimal(12,2) NOT NULL,
  "receivedQuantity" decimal(12,2),
  "unit" varchar(50),
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tri_transfer_request_idx" ON "transferRequestItems" USING btree ("transferRequestId");

CREATE TABLE IF NOT EXISTS "transfers" (
  "id" serial PRIMARY KEY NOT NULL,
  "transferNumber" varchar(20) NOT NULL UNIQUE,
  "transferRequestId" integer NOT NULL,
  "status" "transfer_status" DEFAULT 'pendiente' NOT NULL,
  "remissionGuideNumber" varchar(50),
  "sapCorrelative" varchar(50),
  "confirmedById" integer,
  "confirmedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tf_transfer_request_idx" ON "transfers" USING btree ("transferRequestId");
CREATE INDEX IF NOT EXISTS "tf_status_idx" ON "transfers" USING btree ("status");

CREATE TABLE IF NOT EXISTS "remissionGuides" (
  "id" serial PRIMARY KEY NOT NULL,
  "guideNumber" varchar(50) NOT NULL UNIQUE,
  "transferId" integer NOT NULL,
  "sapCorrelative" varchar(50) NOT NULL,
  "documentName" varchar(255),
  "documentMimeType" varchar(100),
  "documentContent" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rg_transfer_idx" ON "remissionGuides" USING btree ("transferId");

CREATE TABLE IF NOT EXISTS "receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "receiptNumber" varchar(20) NOT NULL UNIQUE,
  "sourceType" "receipt_source_type" NOT NULL,
  "sourceId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "receivedById" integer NOT NULL,
  "status" "receipt_status" DEFAULT 'pendiente' NOT NULL,
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rec_source_idx" ON "receipts" USING btree ("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "rec_project_idx" ON "receipts" USING btree ("projectId");

CREATE TABLE IF NOT EXISTS "receiptItems" (
  "id" serial PRIMARY KEY NOT NULL,
  "receiptId" integer NOT NULL,
  "sourceItemId" integer NOT NULL,
  "itemName" varchar(500) NOT NULL,
  "quantityExpected" decimal(12,2) NOT NULL,
  "quantityReceived" decimal(12,2) NOT NULL,
  "unit" varchar(50),
  "notes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "reci_receipt_idx" ON "receiptItems" USING btree ("receiptId");
