ALTER TABLE "warehouseExitItems"
  ADD COLUMN IF NOT EXISTS "destinationProjectId" integer,
  ADD COLUMN IF NOT EXISTS "destinationWarehouseId" integer;

DO $$
BEGIN
  ALTER TABLE "warehouseExitItems"
    ADD CONSTRAINT "warehouseExitItems_destinationWarehouseId_warehouses_id_fk"
    FOREIGN KEY ("destinationWarehouseId")
    REFERENCES "warehouses"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "wei_destination_project_idx"
  ON "warehouseExitItems" USING btree ("destinationProjectId");

CREATE INDEX IF NOT EXISTS "wei_destination_warehouse_idx"
  ON "warehouseExitItems" USING btree ("destinationWarehouseId");
