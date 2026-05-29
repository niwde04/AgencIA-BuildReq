ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "localCode" varchar(20),
  ADD COLUMN IF NOT EXISTS "isDefault" boolean DEFAULT false NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouses_projectId_unique'
  ) THEN
    ALTER TABLE "warehouses" DROP CONSTRAINT "warehouses_projectId_unique";
  END IF;
END $$;

UPDATE "warehouses"
SET "localCode" = CASE
    WHEN "projectId" IS NOT NULL THEN coalesce(nullif(trim("localCode"), ''), 'GENERAL')
    ELSE coalesce(nullif(trim("localCode"), ''), "code")
  END,
  "updatedAt" = now()
WHERE "localCode" IS NULL OR trim("localCode") = '';

WITH ranked_project_warehouses AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "projectId"
      ORDER BY "isDefault" DESC, "isActive" DESC, "id" ASC
    ) AS rn
  FROM "warehouses"
  WHERE "projectId" IS NOT NULL
)
UPDATE "warehouses" AS warehouse
SET "isDefault" = ranked.rn = 1,
  "updatedAt" = now()
FROM ranked_project_warehouses AS ranked
WHERE warehouse."id" = ranked."id";

CREATE UNIQUE INDEX IF NOT EXISTS "wh_project_local_code_unique"
  ON "warehouses" ("projectId", "localCode");

CREATE UNIQUE INDEX IF NOT EXISTS "wh_project_default_unique"
  ON "warehouses" ("projectId")
  WHERE "projectId" IS NOT NULL AND "isDefault" = true;

CREATE INDEX IF NOT EXISTS "wh_project_default_idx"
  ON "warehouses" USING btree ("projectId", "isDefault");

ALTER TABLE "receiptItems"
  ADD COLUMN IF NOT EXISTS "warehouseId" integer;

ALTER TABLE "warehouseExitItems"
  ADD COLUMN IF NOT EXISTS "warehouseId" integer;

ALTER TABLE "reverseLogisticsItems"
  ADD COLUMN IF NOT EXISTS "warehouseId" integer;

ALTER TABLE "transferRequestItems"
  ADD COLUMN IF NOT EXISTS "sourceWarehouseId" integer;

CREATE INDEX IF NOT EXISTS "reci_warehouse_idx"
  ON "receiptItems" USING btree ("warehouseId");

CREATE INDEX IF NOT EXISTS "wei_warehouse_idx"
  ON "warehouseExitItems" USING btree ("warehouseId");

CREATE INDEX IF NOT EXISTS "rli_warehouse_idx"
  ON "reverseLogisticsItems" USING btree ("warehouseId");

CREATE INDEX IF NOT EXISTS "tri_source_warehouse_idx"
  ON "transferRequestItems" USING btree ("sourceWarehouseId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receiptItems_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "receiptItems"
      ADD CONSTRAINT "receiptItems_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouseExitItems_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "warehouseExitItems"
      ADD CONSTRAINT "warehouseExitItems_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reverseLogisticsItems_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "reverseLogisticsItems"
      ADD CONSTRAINT "reverseLogisticsItems_warehouseId_warehouses_id_fk"
      FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transferRequestItems_sourceWarehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "transferRequestItems"
      ADD CONSTRAINT "transferRequestItems_sourceWarehouseId_warehouses_id_fk"
      FOREIGN KEY ("sourceWarehouseId") REFERENCES "public"."warehouses"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

WITH default_warehouses AS (
  SELECT "projectId", "id"
  FROM "warehouses"
  WHERE "projectId" IS NOT NULL AND "isDefault" = true
)
UPDATE "receiptItems" AS receipt_item
SET "warehouseId" = default_warehouse."id"
FROM "receipts" AS receipt
JOIN default_warehouses AS default_warehouse
  ON default_warehouse."projectId" = receipt."projectId"
WHERE receipt_item."receiptId" = receipt."id"
  AND receipt_item."warehouseId" IS NULL;

WITH exit_warehouses AS (
  SELECT
    warehouse_exit."id" AS "warehouseExitId",
    coalesce(warehouse_exit."warehouseId", default_warehouse."id") AS "warehouseId"
  FROM "warehouseExits" AS warehouse_exit
  LEFT JOIN "warehouses" AS default_warehouse
    ON default_warehouse."projectId" = warehouse_exit."projectId"
   AND default_warehouse."isDefault" = true
)
UPDATE "warehouseExitItems" AS exit_item
SET "warehouseId" = exit_warehouse."warehouseId"
FROM exit_warehouses AS exit_warehouse
WHERE exit_item."warehouseExitId" = exit_warehouse."warehouseExitId"
  AND exit_item."warehouseId" IS NULL
  AND exit_warehouse."warehouseId" IS NOT NULL;

WITH source_exit_item_warehouses AS (
  SELECT "id", "warehouseId"
  FROM "warehouseExitItems"
  WHERE "warehouseId" IS NOT NULL
)
UPDATE "reverseLogisticsItems" AS return_item
SET "warehouseId" = source_item."warehouseId"
FROM source_exit_item_warehouses AS source_item
WHERE return_item."sourceWarehouseExitItemId" = source_item."id"
  AND return_item."warehouseId" IS NULL;

WITH return_default_warehouses AS (
  SELECT
    reverse_logistic."id" AS "reverseLogisticId",
    default_warehouse."id" AS "warehouseId"
  FROM "reverseLogistics" AS reverse_logistic
  JOIN "warehouses" AS default_warehouse
    ON default_warehouse."projectId" = reverse_logistic."sourceProjectId"
   AND default_warehouse."isDefault" = true
)
UPDATE "reverseLogisticsItems" AS return_item
SET "warehouseId" = return_default."warehouseId"
FROM return_default_warehouses AS return_default
WHERE return_item."reverseLogisticId" = return_default."reverseLogisticId"
  AND return_item."warehouseId" IS NULL;

WITH transfer_default_warehouses AS (
  SELECT
    transfer_item."id" AS "transferRequestItemId",
    default_warehouse."id" AS "warehouseId"
  FROM "transferRequestItems" AS transfer_item
  JOIN "transferRequests" AS transfer_request
    ON transfer_item."transferRequestId" = transfer_request."id"
  JOIN "warehouses" AS default_warehouse
    ON default_warehouse."projectId" = transfer_request."projectId"
   AND default_warehouse."isDefault" = true
)
UPDATE "transferRequestItems" AS transfer_item
SET "sourceWarehouseId" = transfer_default."warehouseId"
FROM transfer_default_warehouses AS transfer_default
WHERE transfer_item."id" = transfer_default."transferRequestItemId"
  AND transfer_item."sourceWarehouseId" IS NULL;
