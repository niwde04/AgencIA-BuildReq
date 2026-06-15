ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "isCentralWarehouse" boolean DEFAULT false NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "wh_central_warehouse_unique"
  ON "warehouses" USING btree ("isCentralWarehouse")
  WHERE "isCentralWarehouse" = true;
