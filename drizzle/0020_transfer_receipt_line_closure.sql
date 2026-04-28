ALTER TYPE "transfer_status" ADD VALUE IF NOT EXISTS 'cerrado_incompleto';

ALTER TABLE "transferRequestItems"
  ADD COLUMN IF NOT EXISTS "returnedToOriginQuantity" decimal(12, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "receiptClosed" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "receiptClosedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "receiptClosedById" integer,
  ADD COLUMN IF NOT EXISTS "receiptCloseReason" varchar(120),
  ADD COLUMN IF NOT EXISTS "receiptCloseNote" text;
