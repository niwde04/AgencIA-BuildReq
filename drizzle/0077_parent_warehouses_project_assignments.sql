ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "warehouseId" integer;

ALTER TABLE "openingBalances"
  DROP CONSTRAINT IF EXISTS "openingBalances_warehouseId_unique";

DROP INDEX IF EXISTS "ob_project_warehouse_unique";

CREATE TEMP TABLE IF NOT EXISTS "_warehouse_canonical_map" (
  "warehouseId" integer PRIMARY KEY,
  "canonicalWarehouseId" integer NOT NULL
) ON COMMIT DROP;

TRUNCATE TABLE "_warehouse_canonical_map";

INSERT INTO "_warehouse_canonical_map" ("warehouseId", "canonicalWarehouseId")
WITH normalized AS (
  SELECT
    "id",
    upper(
      regexp_replace(
        coalesce(nullif(trim("localCode"), ''), nullif(trim("code"), ''), ''),
        '[^A-Z0-9]+',
        '-',
        'g'
      )
    ) AS normalized_code,
    upper(regexp_replace(coalesce(trim("name"), ''), '\s+', ' ', 'g')) AS normalized_name,
    "isActive",
    "createdAt"
  FROM "warehouses"
),
ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY normalized_code, normalized_name
      ORDER BY "isActive" DESC, "createdAt" ASC, "id" ASC
    ) AS canonical_id
  FROM normalized
)
SELECT "id", canonical_id
FROM ranked;

WITH inventory_counts AS (
  SELECT "warehouseId", count(*) AS inventory_rows
  FROM "inventoryItems"
  WHERE "warehouseId" IS NOT NULL
  GROUP BY "warehouseId"
),
ranked_project_warehouses AS (
  SELECT
    warehouse."projectId",
    warehouse."id",
    warehouse."isDefault",
    warehouse."isActive",
    coalesce(inventory_counts.inventory_rows, 0) AS inventory_rows,
    row_number() OVER (
      PARTITION BY warehouse."projectId"
      ORDER BY
        warehouse."isDefault" DESC,
        warehouse."isActive" DESC,
        coalesce(inventory_counts.inventory_rows, 0) DESC,
        warehouse."createdAt" ASC,
        warehouse."id" ASC
    ) AS rn
  FROM "warehouses" AS warehouse
  LEFT JOIN inventory_counts
    ON inventory_counts."warehouseId" = warehouse."id"
  WHERE warehouse."projectId" IS NOT NULL
),
selected_project_warehouses AS (
  SELECT
    ranked_project_warehouses."projectId",
    canonical_map."canonicalWarehouseId"
  FROM ranked_project_warehouses
  JOIN "_warehouse_canonical_map" AS canonical_map
    ON canonical_map."warehouseId" = ranked_project_warehouses."id"
  WHERE ranked_project_warehouses.rn = 1
)
UPDATE "projects" AS project
SET
  "warehouseId" = selected_project_warehouses."canonicalWarehouseId",
  "updatedAt" = now()
FROM selected_project_warehouses
WHERE project."id" = selected_project_warehouses."projectId"
  AND project."warehouseId" IS DISTINCT FROM selected_project_warehouses."canonicalWarehouseId";

UPDATE "inventoryItems" AS inventory
SET
  "warehouseId" = project."warehouseId",
  "warehouseLocation" = warehouse."displayName",
  "updatedAt" = now()
FROM "projects" AS project
JOIN "warehouses" AS warehouse
  ON warehouse."id" = project."warehouseId"
WHERE inventory."projectId" = project."id"
  AND project."warehouseId" IS NOT NULL
  AND (
    inventory."warehouseId" IS DISTINCT FROM project."warehouseId"
    OR inventory."warehouseLocation" IS DISTINCT FROM warehouse."displayName"
  );

UPDATE "receiptItems" AS item
SET "warehouseId" = canonical_map."canonicalWarehouseId"
FROM "_warehouse_canonical_map" AS canonical_map
WHERE item."warehouseId" = canonical_map."warehouseId"
  AND item."warehouseId" IS DISTINCT FROM canonical_map."canonicalWarehouseId";

UPDATE "warehouseExits" AS warehouse_exit
SET
  "warehouseId" = canonical_map."canonicalWarehouseId",
  "updatedAt" = now()
FROM "_warehouse_canonical_map" AS canonical_map
WHERE warehouse_exit."warehouseId" = canonical_map."warehouseId"
  AND warehouse_exit."warehouseId" IS DISTINCT FROM canonical_map."canonicalWarehouseId";

UPDATE "warehouseExitItems" AS item
SET
  "warehouseId" = canonical_map."canonicalWarehouseId",
  "updatedAt" = now()
FROM "_warehouse_canonical_map" AS canonical_map
WHERE item."warehouseId" = canonical_map."warehouseId"
  AND item."warehouseId" IS DISTINCT FROM canonical_map."canonicalWarehouseId";

UPDATE "openingBalances" AS balance
SET
  "warehouseId" = canonical_map."canonicalWarehouseId",
  "updatedAt" = now()
FROM "_warehouse_canonical_map" AS canonical_map
WHERE balance."warehouseId" = canonical_map."warehouseId"
  AND balance."warehouseId" IS DISTINCT FROM canonical_map."canonicalWarehouseId";

CREATE TEMP TABLE IF NOT EXISTS "_opening_balance_canonical_map" (
  "openingBalanceId" integer PRIMARY KEY,
  "canonicalOpeningBalanceId" integer NOT NULL
) ON COMMIT DROP;

TRUNCATE TABLE "_opening_balance_canonical_map";

INSERT INTO "_opening_balance_canonical_map" (
  "openingBalanceId",
  "canonicalOpeningBalanceId"
)
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "projectId", "warehouseId"
      ORDER BY "openingDate" ASC, "createdAt" ASC, "id" ASC
    ) AS canonical_id
  FROM "openingBalances"
)
SELECT "id", canonical_id
FROM ranked;

UPDATE "openingBalanceItems" AS item
SET
  "openingBalanceId" = balance_map."canonicalOpeningBalanceId",
  "updatedAt" = now()
FROM "_opening_balance_canonical_map" AS balance_map
WHERE item."openingBalanceId" = balance_map."openingBalanceId"
  AND item."openingBalanceId" IS DISTINCT FROM balance_map."canonicalOpeningBalanceId";

DELETE FROM "openingBalances" AS balance
USING "_opening_balance_canonical_map" AS balance_map
WHERE balance."id" = balance_map."openingBalanceId"
  AND balance."id" IS DISTINCT FROM balance_map."canonicalOpeningBalanceId";

UPDATE "reverseLogisticsItems" AS item
SET "warehouseId" = canonical_map."canonicalWarehouseId"
FROM "_warehouse_canonical_map" AS canonical_map
WHERE item."warehouseId" = canonical_map."warehouseId"
  AND item."warehouseId" IS DISTINCT FROM canonical_map."canonicalWarehouseId";

UPDATE "transferRequestItems" AS item
SET
  "sourceWarehouseId" = canonical_map."canonicalWarehouseId",
  "updatedAt" = now()
FROM "_warehouse_canonical_map" AS canonical_map
WHERE item."sourceWarehouseId" = canonical_map."warehouseId"
  AND item."sourceWarehouseId" IS DISTINCT FROM canonical_map."canonicalWarehouseId";

UPDATE "warehouses" AS duplicate
SET
  "isActive" = false,
  "isDefault" = false,
  "updatedAt" = now()
FROM "_warehouse_canonical_map" AS canonical_map
WHERE duplicate."id" = canonical_map."warehouseId"
  AND duplicate."id" <> canonical_map."canonicalWarehouseId";

UPDATE "warehouses"
SET
  "projectId" = NULL,
  "isDefault" = false,
  "updatedAt" = now()
WHERE "projectId" IS NOT NULL
   OR "isDefault" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId")
      REFERENCES "public"."warehouses"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "proj_warehouse_idx"
  ON "projects" USING btree ("warehouseId");

CREATE UNIQUE INDEX IF NOT EXISTS "ob_project_warehouse_unique"
  ON "openingBalances" ("projectId", "warehouseId");

DROP INDEX IF EXISTS "wh_project_default_idx";
DROP INDEX IF EXISTS "wh_project_default_unique";
DROP INDEX IF EXISTS "wh_project_local_code_unique";
DROP INDEX IF EXISTS "wh_project_idx";

ALTER TABLE "warehouses"
  DROP CONSTRAINT IF EXISTS "warehouses_projectId_unique",
  DROP CONSTRAINT IF EXISTS "warehouses_projectId_projects_id_fk";

ALTER TABLE "warehouses"
  DROP COLUMN IF EXISTS "projectId";
