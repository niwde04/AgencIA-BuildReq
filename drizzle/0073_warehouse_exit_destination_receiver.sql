ALTER TABLE "warehouseExits"
  ADD COLUMN IF NOT EXISTS "receivedByName" varchar(255);

ALTER TABLE "warehouseExitItems"
  ADD COLUMN IF NOT EXISTS "targetType" "material_request_target_type",
  ADD COLUMN IF NOT EXISTS "subProjectId" integer REFERENCES "projectSubprojects"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "fixedAssetSapItemCode" varchar(50),
  ADD COLUMN IF NOT EXISTS "fixedAssetName" varchar(500);

CREATE INDEX IF NOT EXISTS "wei_sub_project_idx"
  ON "warehouseExitItems" ("subProjectId");

UPDATE "warehouseExitItems" AS wei
SET
  "targetType" = ri."targetType",
  "subProjectId" = CASE
    WHEN ri."targetType" = 'subproyecto' THEN ri."subProjectId"
    ELSE NULL
  END,
  "fixedAssetSapItemCode" = CASE
    WHEN ri."targetType" = 'activo_fijo' THEN ri."fixedAssetSapItemCode"
    ELSE NULL
  END,
  "fixedAssetName" = CASE
    WHEN ri."targetType" = 'activo_fijo' THEN ri."fixedAssetName"
    ELSE NULL
  END,
  "updatedAt" = now()
FROM "requestItems" AS ri
WHERE wei."materialRequestItemId" = ri."id"
  AND wei."targetType" IS NULL
  AND ri."targetType" IS NOT NULL;
