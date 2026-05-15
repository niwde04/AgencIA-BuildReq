DROP INDEX IF EXISTS "mr_subproject_idx";
DROP INDEX IF EXISTS "mr_fixed_asset_idx";

ALTER TABLE "materialRequests"
DROP CONSTRAINT IF EXISTS "materialRequests_subProjectId_projectSubprojects_id_fk";

ALTER TABLE "materialRequests"
DROP COLUMN IF EXISTS "targetType",
DROP COLUMN IF EXISTS "subProjectId",
DROP COLUMN IF EXISTS "fixedAssetSapItemCode",
DROP COLUMN IF EXISTS "fixedAssetName";
