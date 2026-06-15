ALTER TABLE "transferRequests"
  ADD COLUMN IF NOT EXISTS "destinationWarehouseId" integer;

DO $$
BEGIN
  ALTER TABLE "transferRequests"
    ADD CONSTRAINT "transferRequests_destinationWarehouseId_warehouses_id_fk"
    FOREIGN KEY ("destinationWarehouseId")
    REFERENCES "warehouses"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "tr_destination_warehouse_idx"
  ON "transferRequests" USING btree ("destinationWarehouseId");
