ALTER TABLE "purchaseOrderItems"
  ADD COLUMN IF NOT EXISTS "receiptClosed" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "receiptClosedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "receiptClosedById" integer,
  ADD COLUMN IF NOT EXISTS "receiptCloseNote" text;
