ALTER TABLE "requestItems"
ADD COLUMN IF NOT EXISTS "warehouseId" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'requestItems_warehouseId_warehouses_id_fk'
  ) THEN
    ALTER TABLE "requestItems"
    ADD CONSTRAINT "requestItems_warehouseId_warehouses_id_fk"
    FOREIGN KEY ("warehouseId")
    REFERENCES "public"."warehouses"("id")
    ON DELETE set null
    ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ri_warehouse_idx"
ON "requestItems" USING btree ("warehouseId");
