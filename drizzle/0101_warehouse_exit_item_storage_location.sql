ALTER TABLE "warehouseExitItems"
ADD COLUMN IF NOT EXISTS "storageLocation" varchar(255);
