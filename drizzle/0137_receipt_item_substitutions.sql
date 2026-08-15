BEGIN;

ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "requestedItemName" varchar(500),
  ADD COLUMN IF NOT EXISTS "requestedSapItemCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "requestedBrand" varchar(120),
  ADD COLUMN IF NOT EXISTS "requestedPartNumber" varchar(120),
  ADD COLUMN IF NOT EXISTS "receivedArticleId" integer,
  ADD COLUMN IF NOT EXISTS "receivedBrand" varchar(120),
  ADD COLUMN IF NOT EXISTS "receivedPartNumber" varchar(120),
  ADD COLUMN IF NOT EXISTS "isSubstitution" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receiptItems_receivedArticleId_sapCatalog_id_fk'
  ) THEN
    ALTER TABLE "receiptItems"
      ADD CONSTRAINT "receiptItems_receivedArticleId_sapCatalog_id_fk"
      FOREIGN KEY ("receivedArticleId") REFERENCES "sapCatalog"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "reci_received_article_idx"
  ON "receiptItems" ("receivedArticleId");

CREATE INDEX IF NOT EXISTS "sap_cat_normalized_brand_part_idx"
  ON "sapCatalog" (
    lower(regexp_replace(trim(coalesce("brand", '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce("partNumber", '')), '\s+', ' ', 'g'))
  )
  WHERE nullif(trim(coalesce("brand", '')), '') IS NOT NULL
    AND nullif(trim(coalesce("partNumber", '')), '') IS NOT NULL;

WITH historical_snapshots AS (
  SELECT
    receipt_item."id" AS "receiptItemId",
    purchase_order_item."itemName" AS "requestedItemName",
    coalesce(
      purchase_order_item."currentSapItemCode",
      purchase_order_item."originalSapItemCode",
      receipt_item."sapItemCode"
    ) AS "requestedSapItemCode",
    requested_catalog."brand" AS "requestedBrand",
    requested_catalog."partNumber" AS "requestedPartNumber",
    received_catalog."id" AS "receivedArticleId",
    coalesce(received_catalog."brand", requested_catalog."brand")
      AS "receivedBrand",
    coalesce(received_catalog."partNumber", requested_catalog."partNumber")
      AS "receivedPartNumber"
  FROM "receiptItems" AS receipt_item
  INNER JOIN "purchaseOrderItems" AS purchase_order_item
    ON receipt_item."sourceItemId" = purchase_order_item."id"
  LEFT JOIN "sapCatalog" AS requested_catalog
    ON requested_catalog."itemCode" = coalesce(
      purchase_order_item."currentSapItemCode",
      purchase_order_item."originalSapItemCode"
    )
  LEFT JOIN "sapCatalog" AS received_catalog
    ON received_catalog."itemCode" = receipt_item."sapItemCode"
)
UPDATE "receiptItems" AS receipt_item
SET
  "requestedItemName" = coalesce(
    receipt_item."requestedItemName",
    historical_snapshots."requestedItemName",
    receipt_item."itemName"
  ),
  "requestedSapItemCode" = coalesce(
    receipt_item."requestedSapItemCode",
    historical_snapshots."requestedSapItemCode"
  ),
  "requestedBrand" = coalesce(
    receipt_item."requestedBrand",
    historical_snapshots."requestedBrand"
  ),
  "requestedPartNumber" = coalesce(
    receipt_item."requestedPartNumber",
    historical_snapshots."requestedPartNumber"
  ),
  "receivedArticleId" = coalesce(
    receipt_item."receivedArticleId",
    historical_snapshots."receivedArticleId"
  ),
  "receivedBrand" = coalesce(
    receipt_item."receivedBrand",
    historical_snapshots."receivedBrand"
  ),
  "receivedPartNumber" = coalesce(
    receipt_item."receivedPartNumber",
    historical_snapshots."receivedPartNumber"
  )
FROM historical_snapshots
WHERE receipt_item."id" = historical_snapshots."receiptItemId";

COMMIT;
