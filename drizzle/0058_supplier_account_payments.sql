ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "subjectToAccountPayments" boolean DEFAULT true NOT NULL;

UPDATE "suppliers"
SET "subjectToAccountPayments" = true
WHERE "subjectToAccountPayments" IS NULL;
