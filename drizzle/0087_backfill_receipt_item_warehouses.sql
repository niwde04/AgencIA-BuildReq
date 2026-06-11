-- Backfill historical receipt lines that created inventory but were saved without
-- a warehouse reference. New registrations are guarded in backend code.
WITH resolved_receipt_warehouses AS (
  SELECT
    ri."id" AS receipt_item_id,
    COALESCE(
      p."warehouseId",
      primary_assignment."warehouseId",
      first_assignment."warehouseId"
    ) AS warehouse_id
  FROM "receiptItems" ri
  INNER JOIN "receipts" r ON r."id" = ri."receiptId"
  LEFT JOIN "projects" p ON p."id" = r."projectId"
  LEFT JOIN LATERAL (
    SELECT pwa."warehouseId"
    FROM "projectWarehouseAssignments" pwa
    WHERE pwa."projectId" = r."projectId"
      AND pwa."isPrimary" = true
    ORDER BY pwa."id" ASC
    LIMIT 1
  ) primary_assignment ON true
  LEFT JOIN LATERAL (
    SELECT pwa."warehouseId"
    FROM "projectWarehouseAssignments" pwa
    WHERE pwa."projectId" = r."projectId"
    ORDER BY pwa."isPrimary" DESC, pwa."id" ASC
    LIMIT 1
  ) first_assignment ON true
  WHERE ri."warehouseId" IS NULL
    AND r."sourceType" IN ('purchase_order', 'transfer')
    AND ri."quantityReceived"::numeric > 0
)
UPDATE "receiptItems" ri
SET "warehouseId" = resolved.warehouse_id
FROM resolved_receipt_warehouses resolved
WHERE ri."id" = resolved.receipt_item_id
  AND resolved.warehouse_id IS NOT NULL;
