BEGIN;

ALTER TABLE IF EXISTS "purchaseOrders"
ADD COLUMN IF NOT EXISTS "issuedAt" timestamp;

UPDATE "purchaseOrders" AS po
SET "issuedAt" = COALESCE(
  (
    SELECT seal."sealedAt"
    FROM "purchaseOrderDigitalSeals" AS seal
    WHERE seal."purchaseOrderId" = po."id"
    ORDER BY seal."sealedAt" ASC, seal."id" ASC
    LIMIT 1
  ),
  po."printedAt",
  po."updatedAt",
  po."createdAt"
)
WHERE po."issuedAt" IS NULL
  AND (
    po."status"::text IN (
      'emitida',
      'enviada',
      'parcialmente_recibida',
      'recibida'
    )
    OR EXISTS (
      SELECT 1
      FROM "purchaseOrderDigitalSeals" AS seal
      WHERE seal."purchaseOrderId" = po."id"
    )
  );

CREATE INDEX IF NOT EXISTS "po_issued_at_idx"
ON "purchaseOrders" ("issuedAt")
WHERE "issuedAt" IS NOT NULL;

COMMIT;
