ALTER TABLE "receiptItems"
ADD COLUMN IF NOT EXISTS "unitPrice" decimal(12, 2) DEFAULT '0.00' NOT NULL;

UPDATE "receiptItems" AS receipt_item
SET "unitPrice" = COALESCE(order_item."unitPrice", '0.00')
FROM "receipts" AS receipt, "purchaseOrderItems" AS order_item
WHERE receipt_item."receiptId" = receipt.id
  AND order_item.id = receipt_item."sourceItemId"
  AND receipt."sourceType" = 'purchase_order'
  AND receipt_item."unitPrice" = '0.00';
