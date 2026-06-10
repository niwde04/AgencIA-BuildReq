ALTER TABLE "reverseLogistics"
ADD COLUMN IF NOT EXISTS "destinationWarehouseId" integer REFERENCES "warehouses"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "rl_destination_warehouse_idx"
ON "reverseLogistics" ("destinationWarehouseId");
