BEGIN;

ALTER TABLE "openingBalanceItems"
  ADD COLUMN IF NOT EXISTS "projectId" integer,
  ADD COLUMN IF NOT EXISTS "storageLocation" varchar(255);

-- Existing entries keep their historical project. Their original physical
-- location is unknown; do not infer it from current inventory or move stock.
UPDATE "openingBalanceItems" AS item
SET "projectId" = balance."projectId"
FROM "openingBalances" AS balance
WHERE item."openingBalanceId" = balance.id AND item."projectId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"openingBalanceItems"'::regclass
      AND conname = 'openingBalanceItems_projectId_projects_id_fk'
  ) THEN
    ALTER TABLE "openingBalanceItems"
      ADD CONSTRAINT "openingBalanceItems_projectId_projects_id_fk"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
