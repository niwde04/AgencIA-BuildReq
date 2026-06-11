DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'anulada'
      AND enumtypid = 'receipt_status'::regtype
  ) THEN
    ALTER TYPE "receipt_status" ADD VALUE 'anulada';
  END IF;
END $$;

ALTER TABLE "receipts"
ADD COLUMN IF NOT EXISTS "voidedAt" timestamp,
ADD COLUMN IF NOT EXISTS "voidedById" integer,
ADD COLUMN IF NOT EXISTS "voidReason" text,
ADD COLUMN IF NOT EXISTS "replacementReceiptId" integer,
ADD COLUMN IF NOT EXISTS "correctsReceiptId" integer;

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "voidedAt" timestamp,
ADD COLUMN IF NOT EXISTS "voidedById" integer,
ADD COLUMN IF NOT EXISTS "voidReason" text;
