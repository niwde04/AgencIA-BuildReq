ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "targetType" material_request_target_type,
  ADD COLUMN IF NOT EXISTS "subProjectId" integer,
  ADD COLUMN IF NOT EXISTS "fixedAssetSapItemCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "fixedAssetName" varchar(500);

ALTER TABLE "invoiceItems"
  ADD COLUMN IF NOT EXISTS "targetType" material_request_target_type,
  ADD COLUMN IF NOT EXISTS "subProjectId" integer,
  ADD COLUMN IF NOT EXISTS "fixedAssetSapItemCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "fixedAssetName" varchar(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receiptItems_subProjectId_projectSubprojects_id_fk'
  ) THEN
    ALTER TABLE "receiptItems"
      ADD CONSTRAINT "receiptItems_subProjectId_projectSubprojects_id_fk"
      FOREIGN KEY ("subProjectId")
      REFERENCES "projectSubprojects"("id")
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoiceItems_subProjectId_projectSubprojects_id_fk'
  ) THEN
    ALTER TABLE "invoiceItems"
      ADD CONSTRAINT "invoiceItems_subProjectId_projectSubprojects_id_fk"
      FOREIGN KEY ("subProjectId")
      REFERENCES "projectSubprojects"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reci_subproject_idx"
  ON "receiptItems" ("subProjectId");

CREATE INDEX IF NOT EXISTS "reci_fixed_asset_idx"
  ON "receiptItems" ("fixedAssetSapItemCode");

CREATE INDEX IF NOT EXISTS "invi_subproject_idx"
  ON "invoiceItems" ("subProjectId");

CREATE INDEX IF NOT EXISTS "invi_fixed_asset_idx"
  ON "invoiceItems" ("fixedAssetSapItemCode");

WITH receipt_source_targets AS (
  SELECT
    ri."id" AS "receiptItemId",
    COALESCE(pri."targetType", reqi."targetType") AS "targetType",
    COALESCE(pri."subProjectId", reqi."subProjectId") AS "subProjectId",
    COALESCE(pri."fixedAssetSapItemCode", reqi."fixedAssetSapItemCode") AS "fixedAssetSapItemCode",
    COALESCE(pri."fixedAssetName", reqi."fixedAssetName") AS "fixedAssetName"
  FROM "receiptItems" ri
  INNER JOIN "receipts" r
    ON r."id" = ri."receiptId"
  INNER JOIN "purchaseOrderItems" poi
    ON poi."id" = ri."sourceItemId"
  LEFT JOIN "purchaseRequestItems" pri
    ON pri."id" = poi."purchaseRequestItemId"
  LEFT JOIN "requestItems" reqi
    ON reqi."id" = poi."materialRequestItemId"
  WHERE r."sourceType" = 'purchase_order'
)
UPDATE "receiptItems" ri
SET
  "targetType" = rst."targetType",
  "subProjectId" = CASE
    WHEN rst."targetType" = 'subproyecto' THEN rst."subProjectId"
    ELSE NULL
  END,
  "fixedAssetSapItemCode" = CASE
    WHEN rst."targetType" = 'activo_fijo' THEN rst."fixedAssetSapItemCode"
    ELSE NULL
  END,
  "fixedAssetName" = CASE
    WHEN rst."targetType" = 'activo_fijo' THEN rst."fixedAssetName"
    ELSE NULL
  END
FROM receipt_source_targets rst
WHERE ri."id" = rst."receiptItemId"
  AND ri."targetType" IS NULL
  AND rst."targetType" IS NOT NULL;

UPDATE "invoiceItems" ii
SET
  "targetType" = ri."targetType",
  "subProjectId" = ri."subProjectId",
  "fixedAssetSapItemCode" = ri."fixedAssetSapItemCode",
  "fixedAssetName" = ri."fixedAssetName"
FROM "receiptItems" ri
WHERE ii."receiptItemId" = ri."id"
  AND ii."targetType" IS NULL
  AND ri."targetType" IS NOT NULL;
