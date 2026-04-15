ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "projectId" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouses_projectId_projects_id_fk'
  ) THEN
    ALTER TABLE "warehouses"
      ADD CONSTRAINT "warehouses_projectId_projects_id_fk"
      FOREIGN KEY ("projectId")
      REFERENCES "public"."projects"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouses_projectId_unique'
  ) THEN
    ALTER TABLE "warehouses"
      ADD CONSTRAINT "warehouses_projectId_unique" UNIQUE ("projectId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "wh_project_idx" ON "warehouses" USING btree ("projectId");

INSERT INTO "warehouses" (
  "code",
  "name",
  "displayName",
  "projectId",
  "description",
  "isActive"
)
SELECT
  concat('PRJ-', "project"."id"),
  concat('Bodega ', "project"."name"),
  concat(upper(trim("project"."code")), ' - ', upper(trim("project"."name")), ' - BODEGA'),
  "project"."id",
  CASE
    WHEN nullif(trim(coalesce("project"."location", '')), '') IS NOT NULL
      THEN concat(
        'Almacén operativo del proyecto ',
        "project"."code",
        ' en ',
        trim("project"."location"),
        '.'
      )
    ELSE concat('Almacén operativo del proyecto ', "project"."code", '.')
  END,
  CASE WHEN "project"."status" = 'activo' THEN true ELSE false END
FROM "projects" AS "project"
LEFT JOIN "warehouses" AS "warehouse"
  ON "warehouse"."projectId" = "project"."id"
WHERE "warehouse"."id" IS NULL;

UPDATE "warehouses" AS "warehouse"
SET
  "code" = concat('PRJ-', "project"."id"),
  "name" = concat('Bodega ', "project"."name"),
  "displayName" = concat(
    upper(trim("project"."code")),
    ' - ',
    upper(trim("project"."name")),
    ' - BODEGA'
  ),
  "description" = CASE
    WHEN nullif(trim(coalesce("project"."location", '')), '') IS NOT NULL
      THEN concat(
        'Almacén operativo del proyecto ',
        "project"."code",
        ' en ',
        trim("project"."location"),
        '.'
      )
    ELSE concat('Almacén operativo del proyecto ', "project"."code", '.')
  END,
  "isActive" = CASE WHEN "project"."status" = 'activo' THEN true ELSE false END,
  "updatedAt" = now()
FROM "projects" AS "project"
WHERE "warehouse"."projectId" = "project"."id";

UPDATE "inventoryItems" AS "inventory"
SET
  "warehouseId" = "warehouse"."id",
  "warehouseLocation" = "warehouse"."displayName",
  "updatedAt" = now()
FROM "warehouses" AS "warehouse"
WHERE "warehouse"."projectId" = "inventory"."projectId"
  AND "inventory"."projectId" IS NOT NULL
  AND (
    "inventory"."warehouseId" IS DISTINCT FROM "warehouse"."id"
    OR "inventory"."warehouseLocation" IS DISTINCT FROM "warehouse"."displayName"
  );
