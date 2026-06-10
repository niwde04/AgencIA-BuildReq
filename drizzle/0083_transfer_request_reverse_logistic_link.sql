ALTER TABLE "transferRequests"
  ADD COLUMN IF NOT EXISTS "reverseLogisticId" integer;

CREATE INDEX IF NOT EXISTS "tr_reverse_logistic_idx"
  ON "transferRequests" USING btree ("reverseLogisticId");
