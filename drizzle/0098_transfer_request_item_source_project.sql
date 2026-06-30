ALTER TABLE "transferRequestItems"
  ADD COLUMN IF NOT EXISTS "sourceProjectId" integer;

UPDATE "transferRequestItems" tri
SET "sourceProjectId" = tr."projectId"
FROM "transferRequests" tr
WHERE tri."transferRequestId" = tr."id"
  AND tri."sourceProjectId" IS NULL
  AND tri."sourceWarehouseId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "tri_source_project_idx"
  ON "transferRequestItems" ("sourceProjectId");
