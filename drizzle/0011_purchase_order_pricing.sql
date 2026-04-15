DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'purchase_order_tax_code'
  ) THEN
    CREATE TYPE "purchase_order_tax_code" AS ENUM ('exe', 'isv_15');
  END IF;
END $$;

ALTER TABLE "purchaseOrderItems"
  ADD COLUMN IF NOT EXISTS "unitPrice" decimal(12,2) DEFAULT '0.00' NOT NULL;

ALTER TABLE "purchaseOrderItems"
  ADD COLUMN IF NOT EXISTS "taxCode" "purchase_order_tax_code" DEFAULT 'exe' NOT NULL;
