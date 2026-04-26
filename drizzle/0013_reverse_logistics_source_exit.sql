ALTER TABLE "reverseLogistics"
  ADD COLUMN IF NOT EXISTS "sourceWarehouseExitId" integer;

ALTER TABLE "reverseLogisticsItems"
  ADD COLUMN IF NOT EXISTS "sourceWarehouseExitItemId" integer;

CREATE INDEX IF NOT EXISTS "rli_source_warehouse_exit_item_idx"
  ON "reverseLogisticsItems" USING btree ("sourceWarehouseExitItemId");
