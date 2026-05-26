DO $$
BEGIN
  CREATE TYPE "contract_payment_frequency" AS ENUM (
    'semanal',
    'quincenal',
    'mensual',
    'trimestral',
    'semestral',
    'anual'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "purchaseOrders"
ADD COLUMN IF NOT EXISTS "appliesContract" boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS "contractPaymentFrequency" "contract_payment_frequency",
ADD COLUMN IF NOT EXISTS "contractFirstPaymentDate" timestamp,
ADD COLUMN IF NOT EXISTS "contractEndDate" timestamp,
ADD COLUMN IF NOT EXISTS "contractExpiryNotifiedAt" timestamp;

CREATE TABLE IF NOT EXISTS "purchaseOrderAuditLogs" (
  "id" serial PRIMARY KEY,
  "purchaseOrderId" integer NOT NULL REFERENCES "purchaseOrders"("id") ON DELETE CASCADE,
  "purchaseOrderItemId" integer REFERENCES "purchaseOrderItems"("id") ON DELETE SET NULL,
  "action" varchar(80) NOT NULL,
  "field" varchar(100) NOT NULL,
  "oldValue" text,
  "newValue" text,
  "changedById" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "note" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "po_audit_order_idx"
ON "purchaseOrderAuditLogs" ("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "po_audit_item_idx"
ON "purchaseOrderAuditLogs" ("purchaseOrderItemId");

CREATE INDEX IF NOT EXISTS "po_audit_changed_by_idx"
ON "purchaseOrderAuditLogs" ("changedById");
