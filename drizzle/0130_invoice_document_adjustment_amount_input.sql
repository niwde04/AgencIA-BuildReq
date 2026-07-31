ALTER TABLE "invoiceDocumentAdjustments"
  ADD COLUMN IF NOT EXISTS "inputMode" varchar(20)
    DEFAULT 'percentage' NOT NULL;

ALTER TABLE "invoiceDocumentAdjustments"
  ALTER COLUMN "percentage" TYPE numeric(11,8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invda_input_mode_check'
      AND conrelid = '"invoiceDocumentAdjustments"'::regclass
  ) THEN
    ALTER TABLE "invoiceDocumentAdjustments"
      ADD CONSTRAINT "invda_input_mode_check"
      CHECK (
        "inputMode" IN ('percentage', 'amount')
        AND (
          "adjustmentType" <> 'tc_discount'
          OR "inputMode" = 'percentage'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invda_amount_within_base_check'
      AND conrelid = '"invoiceDocumentAdjustments"'::regclass
  ) THEN
    ALTER TABLE "invoiceDocumentAdjustments"
      ADD CONSTRAINT "invda_amount_within_base_check"
      CHECK ("amount" <= "baseAmount");
  END IF;
END $$;
