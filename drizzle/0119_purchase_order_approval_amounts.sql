-- Montos mínimos configurables para aprobación de órdenes de compra.
ALTER TABLE "systemSettings"
  ADD COLUMN IF NOT EXISTS "purchaseOrderApprovalMinimumHnl" numeric(18, 2),
  ADD COLUMN IF NOT EXISTS "purchaseOrderApprovalMinimumUsd" numeric(18, 2);

UPDATE "systemSettings"
SET
  "purchaseOrderApprovalMinimumHnl" = COALESCE(
    "purchaseOrderApprovalMinimumHnl",
    250000.00
  ),
  "purchaseOrderApprovalMinimumUsd" = COALESCE(
    "purchaseOrderApprovalMinimumUsd",
    10000.00
  )
WHERE "id" = 1;

ALTER TABLE "systemSettings"
  ALTER COLUMN "purchaseOrderApprovalMinimumHnl" SET DEFAULT 250000.00,
  ALTER COLUMN "purchaseOrderApprovalMinimumHnl" SET NOT NULL,
  ALTER COLUMN "purchaseOrderApprovalMinimumUsd" SET DEFAULT 10000.00,
  ALTER COLUMN "purchaseOrderApprovalMinimumUsd" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_settings_po_minimum_hnl_nonnegative'
      AND conrelid = '"systemSettings"'::regclass
  ) THEN
    ALTER TABLE "systemSettings"
      ADD CONSTRAINT "system_settings_po_minimum_hnl_nonnegative"
      CHECK ("purchaseOrderApprovalMinimumHnl" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_settings_po_minimum_usd_nonnegative'
      AND conrelid = '"systemSettings"'::regclass
  ) THEN
    ALTER TABLE "systemSettings"
      ADD CONSTRAINT "system_settings_po_minimum_usd_nonnegative"
      CHECK ("purchaseOrderApprovalMinimumUsd" >= 0);
  END IF;
END $$;
