ALTER TABLE "inventoryItems"
  ADD COLUMN IF NOT EXISTS "storageLocation" varchar(255);
