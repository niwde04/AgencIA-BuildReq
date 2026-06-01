ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "sapItemCode" varchar(50);

WITH receipt_item_codes AS (
  SELECT
    receipt_item.id,
    coalesce(
      purchase_order_item."currentSapItemCode",
      purchase_order_item."originalSapItemCode",
      transfer_request_item."sapItemCode"
    ) AS "sapItemCode"
  FROM "receiptItems" AS receipt_item
  INNER JOIN "receipts" AS receipt
    ON receipt.id = receipt_item."receiptId"
  LEFT JOIN "purchaseOrderItems" AS purchase_order_item
    ON receipt."sourceType" = 'purchase_order'
   AND purchase_order_item.id = receipt_item."sourceItemId"
  LEFT JOIN "transferRequestItems" AS transfer_request_item
    ON receipt."sourceType" = 'transfer'
   AND transfer_request_item.id = receipt_item."sourceItemId"
)
UPDATE "receiptItems" AS receipt_item
SET "sapItemCode" = receipt_item_codes."sapItemCode"
FROM receipt_item_codes
WHERE receipt_item.id = receipt_item_codes.id
  AND receipt_item."sapItemCode" IS NULL
  AND receipt_item_codes."sapItemCode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "reci_sap_item_idx"
  ON "receiptItems" ("sapItemCode");
