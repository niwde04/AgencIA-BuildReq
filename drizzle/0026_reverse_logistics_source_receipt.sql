ALTER TABLE "reverseLogistics"
  ADD COLUMN IF NOT EXISTS "sourceReceiptId" integer;

CREATE INDEX IF NOT EXISTS "rl_source_receipt_idx"
  ON "reverseLogistics" USING btree ("sourceReceiptId");
