ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "createdById" integer;

ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "updatedById" integer;

ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "createdById" integer;

ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "updatedById" integer;

DO $$
BEGIN
  ALTER TABLE "sapCatalog"
  ADD CONSTRAINT "sapCatalog_createdById_users_id_fk"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "sapCatalog"
  ADD CONSTRAINT "sapCatalog_updatedById_users_id_fk"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_createdById_users_id_fk"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_updatedById_users_id_fk"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "sap_cat_created_by_idx"
ON "sapCatalog" USING btree ("createdById");

CREATE INDEX IF NOT EXISTS "sap_cat_updated_by_idx"
ON "sapCatalog" USING btree ("updatedById");

CREATE INDEX IF NOT EXISTS "sup_created_by_idx"
ON "suppliers" USING btree ("createdById");

CREATE INDEX IF NOT EXISTS "sup_updated_by_idx"
ON "suppliers" USING btree ("updatedById");
