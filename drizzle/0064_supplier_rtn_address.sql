ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "rtn" varchar(50),
  ADD COLUMN IF NOT EXISTS "address" text;
