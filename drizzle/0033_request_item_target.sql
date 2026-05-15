ALTER TABLE "requestItems"
ADD COLUMN IF NOT EXISTS "targetType" "material_request_target_type";

ALTER TABLE "requestItems"
ADD COLUMN IF NOT EXISTS "subProjectId" integer;

ALTER TABLE "requestItems"
ADD COLUMN IF NOT EXISTS "fixedAssetSapItemCode" varchar(50);

ALTER TABLE "requestItems"
ADD COLUMN IF NOT EXISTS "fixedAssetName" varchar(500);

DO $$
BEGIN
  ALTER TABLE "requestItems"
  ADD CONSTRAINT "requestItems_subProjectId_projectSubprojects_id_fk"
  FOREIGN KEY ("subProjectId")
  REFERENCES "projectSubprojects"("id")
  ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ri_subproject_idx"
ON "requestItems" ("subProjectId");

CREATE INDEX IF NOT EXISTS "ri_fixed_asset_idx"
ON "requestItems" ("fixedAssetSapItemCode");
