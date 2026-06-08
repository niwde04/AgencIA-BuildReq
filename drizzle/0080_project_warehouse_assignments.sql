CREATE TABLE IF NOT EXISTS "projectWarehouseAssignments" (
  "id" serial PRIMARY KEY,
  "projectId" integer NOT NULL,
  "warehouseId" integer NOT NULL,
  "isPrimary" boolean DEFAULT false NOT NULL,
  "assignedById" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projectWarehouseAssignments_projectId_projects_id_fk'
  ) THEN
    ALTER TABLE "projectWarehouseAssignments"
      ADD CONSTRAINT "projectWarehouseAssignments_projectId_projects_id_fk"
      FOREIGN KEY ("projectId")
      REFERENCES "public"."projects"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projectWarehouseAssignments_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "projectWarehouseAssignments"
      ADD CONSTRAINT "projectWarehouseAssignments_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId")
      REFERENCES "public"."warehouses"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projectWarehouseAssignments_assignedById_users_id_fk'
  ) THEN
    ALTER TABLE "projectWarehouseAssignments"
      ADD CONSTRAINT "projectWarehouseAssignments_assignedById_users_id_fk"
      FOREIGN KEY ("assignedById")
      REFERENCES "public"."users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pwa_project_idx"
  ON "projectWarehouseAssignments" USING btree ("projectId");

CREATE INDEX IF NOT EXISTS "pwa_warehouse_idx"
  ON "projectWarehouseAssignments" USING btree ("warehouseId");

CREATE UNIQUE INDEX IF NOT EXISTS "pwa_project_warehouse_unique"
  ON "projectWarehouseAssignments" ("projectId", "warehouseId");

CREATE UNIQUE INDEX IF NOT EXISTS "pwa_primary_project_unique"
  ON "projectWarehouseAssignments" ("projectId")
  WHERE "isPrimary" = true;

INSERT INTO "projectWarehouseAssignments" (
  "projectId",
  "warehouseId",
  "isPrimary",
  "assignedById",
  "createdAt",
  "updatedAt"
)
SELECT
  project."id",
  project."warehouseId",
  true,
  NULL::integer,
  now(),
  now()
FROM "projects" AS project
WHERE project."warehouseId" IS NOT NULL
ON CONFLICT ("projectId", "warehouseId") DO UPDATE SET
  "isPrimary" = true,
  "updatedAt" = now();
