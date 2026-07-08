ALTER TABLE "transferRequestItems"
ADD COLUMN IF NOT EXISTS "sourceStorageLocation" varchar(255);
