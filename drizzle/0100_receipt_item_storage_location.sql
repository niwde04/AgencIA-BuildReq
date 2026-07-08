ALTER TABLE "receiptItems"
ADD COLUMN IF NOT EXISTS "storageLocation" varchar(255);
