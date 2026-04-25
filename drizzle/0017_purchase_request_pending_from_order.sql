ALTER TABLE "purchaseRequests"
ADD COLUMN IF NOT EXISTS "sourcePurchaseOrderId" integer;

CREATE INDEX IF NOT EXISTS "pr_source_purchase_order_idx"
ON "purchaseRequests" USING btree ("sourcePurchaseOrderId");

ALTER TABLE "purchaseRequestItems"
ADD COLUMN IF NOT EXISTS "sourcePurchaseOrderItemId" integer;
