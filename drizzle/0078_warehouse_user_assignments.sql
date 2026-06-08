CREATE TABLE IF NOT EXISTS "warehouseUserAssignments" (
  "id" serial PRIMARY KEY,
  "warehouseId" integer NOT NULL,
  "userId" integer NOT NULL,
  "isResponsible" boolean DEFAULT false NOT NULL,
  "assignedById" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouseUserAssignments_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "warehouseUserAssignments"
      ADD CONSTRAINT "warehouseUserAssignments_warehouseId_warehouses_id_fk"
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
    WHERE conname = 'warehouseUserAssignments_userId_users_id_fk'
  ) THEN
    ALTER TABLE "warehouseUserAssignments"
      ADD CONSTRAINT "warehouseUserAssignments_userId_users_id_fk"
      FOREIGN KEY ("userId")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouseUserAssignments_assignedById_users_id_fk'
  ) THEN
    ALTER TABLE "warehouseUserAssignments"
      ADD CONSTRAINT "warehouseUserAssignments_assignedById_users_id_fk"
      FOREIGN KEY ("assignedById")
      REFERENCES "public"."users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "wua_warehouse_idx"
  ON "warehouseUserAssignments" USING btree ("warehouseId");

CREATE INDEX IF NOT EXISTS "wua_user_idx"
  ON "warehouseUserAssignments" USING btree ("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "wua_user_warehouse_unique"
  ON "warehouseUserAssignments" ("userId", "warehouseId");

CREATE UNIQUE INDEX IF NOT EXISTS "wua_responsible_unique"
  ON "warehouseUserAssignments" ("warehouseId")
  WHERE "isResponsible" = true;

INSERT INTO "warehouseUserAssignments" (
  "warehouseId",
  "userId",
  "isResponsible",
  "assignedById",
  "createdAt",
  "updatedAt"
)
SELECT
  warehouse."id",
  app_user."id",
  false,
  NULL::integer,
  now(),
  now()
FROM "users" AS app_user
CROSS JOIN "warehouses" AS warehouse
WHERE app_user."buildreqRole" = 'jefe_bodega_central'
  AND warehouse."isActive" = true
ON CONFLICT ("userId", "warehouseId") DO NOTHING;

WITH user_project_scope AS (
  SELECT "userId", "projectId"
  FROM "userProjectAssignments"
  UNION
  SELECT "id" AS "userId", "assignedProjectId" AS "projectId"
  FROM "users"
  WHERE "assignedProjectId" IS NOT NULL
)
INSERT INTO "warehouseUserAssignments" (
  "warehouseId",
  "userId",
  "isResponsible",
  "assignedById",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  project."warehouseId",
  app_user."id",
  false,
  NULL::integer,
  now(),
  now()
FROM "users" AS app_user
JOIN user_project_scope
  ON user_project_scope."userId" = app_user."id"
JOIN "projects" AS project
  ON project."id" = user_project_scope."projectId"
WHERE app_user."buildreqRole" = 'bodeguero_proyecto'
  AND project."warehouseId" IS NOT NULL
ON CONFLICT ("userId", "warehouseId") DO NOTHING;
