ALTER TABLE "transfers"
  ADD COLUMN IF NOT EXISTS "preparedByName" varchar(160),
  ADD COLUMN IF NOT EXISTS "deliveredToName" varchar(160);
