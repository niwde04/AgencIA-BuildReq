ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS 'superintendente_aprobador';
ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS 'gerente';

ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'pendiente_aprobacion';
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'aprobada';
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'rechazada';

ALTER TABLE "purchaseRequests"
  ADD COLUMN IF NOT EXISTS "approvalStatus" "approval_status";

ALTER TABLE "purchaseOrders"
  ADD COLUMN IF NOT EXISTS "approvalStatus" "approval_status";

CREATE TABLE IF NOT EXISTS "procurementApprovalHistory" (
  "id" serial PRIMARY KEY NOT NULL,
  "documentType" varchar(32) NOT NULL,
  "documentId" integer NOT NULL,
  "action" varchar(50) NOT NULL,
  "previousStatus" "approval_status",
  "newStatus" "approval_status",
  "actorUserId" integer NOT NULL,
  "actorName" varchar(255) NOT NULL,
  "actorRole" varchar(80) NOT NULL,
  "comment" text,
  "amount" numeric(18, 2),
  "currency" varchar(3),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "proc_approval_document_type_check"
    CHECK ("documentType" IN ('purchase_request', 'purchase_order')),
  CONSTRAINT "proc_approval_currency_check"
    CHECK ("currency" IS NULL OR "currency" IN ('HNL', 'USD'))
);

CREATE INDEX IF NOT EXISTS "proc_approval_document_date_idx"
  ON "procurementApprovalHistory" ("documentType", "documentId", "createdAt");

CREATE INDEX IF NOT EXISTS "proc_approval_actor_idx"
  ON "procurementApprovalHistory" ("actorUserId");

-- La tabla contiene decisiones internas y no se publica al cliente mediante
-- la Data API. El servidor accede a ella por la conexión directa a Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "procurementApprovalHistory" FROM anon;
    REVOKE ALL ON SEQUENCE "procurementApprovalHistory_id_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "procurementApprovalHistory" FROM authenticated;
    REVOKE ALL ON SEQUENCE "procurementApprovalHistory_id_seq" FROM authenticated;
  END IF;
END
$$;

-- El estado histórico "rechazada" representaba una anulación operativa.
UPDATE "purchaseRequests"
SET
  "status" = 'anulada',
  "approvalStatus" = 'no_requiere',
  "updatedAt" = now()
WHERE "status" = 'rechazada';

-- Los documentos finalizados conservan su estado y quedan exentos por
-- migración. Todo documento todavía abierto regresa a borrador/no enviado.
UPDATE "purchaseRequests"
SET
  "approvalStatus" = 'no_requiere',
  "updatedAt" = now()
WHERE "status" IN ('convertida', 'anulada');

UPDATE "purchaseRequests"
SET
  "status" = 'pendiente',
  "approvalStatus" = NULL,
  "rejectionReason" = NULL,
  "updatedAt" = now()
WHERE "status" NOT IN ('convertida', 'anulada');

UPDATE "purchaseOrders"
SET
  "approvalStatus" = 'no_requiere',
  "updatedAt" = now()
WHERE "status" IN (
  'emitida',
  'enviada',
  'parcialmente_recibida',
  'recibida',
  'anulada'
);

UPDATE "purchaseOrders"
SET
  "approvalStatus" = NULL,
  "updatedAt" = now()
WHERE "status" = 'borrador';
