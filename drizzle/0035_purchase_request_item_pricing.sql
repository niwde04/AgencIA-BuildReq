ALTER TABLE "purchaseRequestItems"
  ADD COLUMN IF NOT EXISTS "unitPrice" decimal(12,2) DEFAULT '0.00' NOT NULL;
