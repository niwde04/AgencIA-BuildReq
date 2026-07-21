ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS 'financiero';
ALTER TYPE "treasury_batch_status" ADD VALUE IF NOT EXISTS 'consolidado';

ALTER TABLE "treasuryPaymentBatches"
  ADD COLUMN IF NOT EXISTS "consolidatedIntoBatchId" integer,
  ADD COLUMN IF NOT EXISTS "consolidatedById" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "consolidatedAt" timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'treasury_batch_consolidated_into_fk'
  ) THEN
    ALTER TABLE "treasuryPaymentBatches"
      ADD CONSTRAINT "treasury_batch_consolidated_into_fk"
      FOREIGN KEY ("consolidatedIntoBatchId")
      REFERENCES "treasuryPaymentBatches"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "treasury_batch_consolidated_into_idx"
  ON "treasuryPaymentBatches" ("consolidatedIntoBatchId");
