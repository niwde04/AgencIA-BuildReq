ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "isSharedWarehouse" boolean DEFAULT false NOT NULL;
