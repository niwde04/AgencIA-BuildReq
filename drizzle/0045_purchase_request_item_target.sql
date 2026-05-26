ALTER TABLE "purchaseRequestItems"
  ADD COLUMN IF NOT EXISTS "targetType" "material_request_target_type",
  ADD COLUMN IF NOT EXISTS "subProjectId" integer REFERENCES "projectSubprojects"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "fixedAssetSapItemCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "fixedAssetName" varchar(500);

UPDATE "purchaseRequestItems" pri
SET
  "targetType" = ri."targetType",
  "subProjectId" = ri."subProjectId",
  "fixedAssetSapItemCode" = ri."fixedAssetSapItemCode",
  "fixedAssetName" = ri."fixedAssetName"
FROM "requestItems" ri
WHERE
  pri."materialRequestItemId" = ri."id"
  AND (
    pri."targetType" IS NULL
    AND pri."subProjectId" IS NULL
    AND pri."fixedAssetSapItemCode" IS NULL
    AND pri."fixedAssetName" IS NULL
  );

CREATE INDEX IF NOT EXISTS "pri_subproject_idx"
  ON "purchaseRequestItems" USING btree ("subProjectId");

CREATE INDEX IF NOT EXISTS "pri_fixed_asset_idx"
  ON "purchaseRequestItems" USING btree ("fixedAssetSapItemCode");
