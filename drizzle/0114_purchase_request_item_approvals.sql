ALTER TABLE "purchaseRequestItems"
  ADD COLUMN IF NOT EXISTS "approvalStatus" "approval_status" DEFAULT 'no_requiere' NOT NULL,
  ADD COLUMN IF NOT EXISTS "approvedById" integer,
  ADD COLUMN IF NOT EXISTS "approvedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "rejectionReason" text;

UPDATE "purchaseRequestItems" AS item
SET "approvalStatus" = CASE
  WHEN request."approvalStatus" = 'pendiente' THEN 'pendiente'::"approval_status"
  WHEN request."approvalStatus" = 'aprobada' THEN 'aprobada'::"approval_status"
  WHEN request."approvalStatus" = 'rechazada' THEN 'rechazada'::"approval_status"
  ELSE 'no_requiere'::"approval_status"
END
FROM "purchaseRequests" AS request
WHERE request."id" = item."purchaseRequestId";

CREATE INDEX IF NOT EXISTS "pri_approval_status_idx"
  ON "purchaseRequestItems" ("approvalStatus");
