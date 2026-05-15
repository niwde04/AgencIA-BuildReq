ALTER TABLE "purchaseRequestItems"
  ADD COLUMN IF NOT EXISTS "convertedQuantity" decimal(12,2) DEFAULT '0.00' NOT NULL;

UPDATE "purchaseRequestItems" pri
SET "convertedQuantity" = COALESCE(converted.total_quantity, 0)
FROM (
  SELECT
    poi."purchaseRequestItemId",
    SUM(poi."quantity") AS total_quantity
  FROM "purchaseOrderItems" poi
  INNER JOIN "purchaseOrders" po
    ON po."id" = poi."purchaseOrderId"
  WHERE poi."purchaseRequestItemId" IS NOT NULL
    AND po."status" <> 'anulada'
  GROUP BY poi."purchaseRequestItemId"
) converted
WHERE pri."id" = converted."purchaseRequestItemId";
