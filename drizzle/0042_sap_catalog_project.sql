ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "projectId" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sapCatalog_projectId_projects_id_fk'
  ) THEN
    ALTER TABLE "sapCatalog"
    ADD CONSTRAINT "sapCatalog_projectId_projects_id_fk"
    FOREIGN KEY ("projectId")
    REFERENCES "projects"("id")
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sap_cat_project_idx"
ON "sapCatalog" USING btree ("projectId");
