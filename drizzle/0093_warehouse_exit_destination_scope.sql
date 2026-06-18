ALTER TABLE "warehouseExits"
  ADD COLUMN IF NOT EXISTS "destinationProjectId" integer,
  ADD COLUMN IF NOT EXISTS "destinationWarehouseId" integer;

DO $$
BEGIN
  ALTER TABLE "warehouseExits"
    ADD CONSTRAINT "warehouseExits_destinationWarehouseId_warehouses_id_fk"
    FOREIGN KEY ("destinationWarehouseId")
    REFERENCES "warehouses"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "we_destination_project_idx"
  ON "warehouseExits" USING btree ("destinationProjectId");

CREATE INDEX IF NOT EXISTS "we_destination_warehouse_idx"
  ON "warehouseExits" USING btree ("destinationWarehouseId");
