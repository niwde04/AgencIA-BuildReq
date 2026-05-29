DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_tax_type') THEN
    CREATE TYPE "sales_tax_type" AS ENUM ('base', 'additional');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_tax_fiscal_category') THEN
    CREATE TYPE "sales_tax_fiscal_category" AS ENUM ('exento', 'exonerado', 'gravado');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "salesTaxes" (
  "id" serial PRIMARY KEY,
  "taxCode" varchar(50) NOT NULL,
  "description" varchar(200) NOT NULL,
  "shortLabel" varchar(80) NOT NULL,
  "ratePercent" decimal(8,4) NOT NULL,
  "taxType" "sales_tax_type" DEFAULT 'base' NOT NULL,
  "fiscalCategory" "sales_tax_fiscal_category" DEFAULT 'gravado' NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "displayOrder" integer DEFAULT 100 NOT NULL,
  "appliesToTaxCodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "erpCode" varchar(50),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_tax_code_idx"
  ON "salesTaxes" ("taxCode");

CREATE INDEX IF NOT EXISTS "sales_tax_active_idx"
  ON "salesTaxes" ("isActive");

CREATE INDEX IF NOT EXISTS "sales_tax_type_idx"
  ON "salesTaxes" ("taxType");

ALTER TABLE "purchaseOrderItems"
  ALTER COLUMN "taxCode" DROP DEFAULT;

ALTER TABLE "purchaseOrderItems"
  ALTER COLUMN "taxCode" TYPE varchar(50)
  USING "taxCode"::text;

ALTER TABLE "purchaseOrderItems"
  ALTER COLUMN "taxCode" SET DEFAULT 'exe';

ALTER TABLE "invoiceItems"
  ALTER COLUMN "taxCode" DROP DEFAULT;

ALTER TABLE "invoiceItems"
  ALTER COLUMN "taxCode" TYPE varchar(50)
  USING "taxCode"::text;

ALTER TABLE "invoiceItems"
  ALTER COLUMN "taxCode" SET DEFAULT 'exe';

ALTER TABLE "purchaseOrderItems"
  ADD COLUMN IF NOT EXISTS "additionalTaxCodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "taxBreakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "invoiceItems"
  ADD COLUMN IF NOT EXISTS "additionalTaxCodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "taxBreakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;

INSERT INTO "salesTaxes"
  ("taxCode", "description", "shortLabel", "ratePercent", "taxType", "fiscalCategory", "isActive", "displayOrder", "appliesToTaxCodes", "note", "erpCode")
VALUES
  ('exe', 'EXE - Exento', 'EXE', '0.0000', 'base', 'exento', true, 10, '[]'::jsonb, 'Importe exento', 'EXE'),
  ('isv_15', 'ISV 15%', 'ISV 15%', '15.0000', 'base', 'gravado', true, 20, '[]'::jsonb, 'Impuesto sobre ventas 15%', 'ISV15'),
  ('isv_18', 'ISV 18%', 'ISV 18%', '18.0000', 'base', 'gravado', true, 30, '[]'::jsonb, 'Impuesto sobre ventas 18%', 'ISV18'),
  ('isv_4', 'ISV 4%', 'ISV 4%', '4.0000', 'base', 'gravado', true, 40, '[]'::jsonb, 'Impuesto sobre ventas 4%', 'ISV4')
ON CONFLICT ("taxCode") DO UPDATE SET
  "description" = EXCLUDED."description",
  "shortLabel" = EXCLUDED."shortLabel",
  "ratePercent" = EXCLUDED."ratePercent",
  "taxType" = EXCLUDED."taxType",
  "fiscalCategory" = EXCLUDED."fiscalCategory",
  "isActive" = EXCLUDED."isActive",
  "displayOrder" = EXCLUDED."displayOrder",
  "appliesToTaxCodes" = EXCLUDED."appliesToTaxCodes",
  "note" = EXCLUDED."note",
  "erpCode" = EXCLUDED."erpCode",
  "updatedAt" = now();

UPDATE "purchaseOrderItems"
SET "taxBreakdown" = CASE
  WHEN "taxCode" = 'isv_15' THEN jsonb_build_array(jsonb_build_object(
    'taxCode', 'isv_15',
    'label', 'ISV 15%',
    'shortLabel', 'ISV 15%',
    'taxType', 'base',
    'fiscalCategory', 'gravado',
    'ratePercent', 15,
    'rate', 0.15,
    'baseAmount', round(("quantity"::numeric * coalesce("unitPrice"::numeric, 0)), 2),
    'amount', round(("quantity"::numeric * coalesce("unitPrice"::numeric, 0)) * 0.15, 2),
    'displayOrder', 20
  ))
  WHEN "taxCode" = 'isv_18' THEN jsonb_build_array(jsonb_build_object(
    'taxCode', 'isv_18',
    'label', 'ISV 18%',
    'shortLabel', 'ISV 18%',
    'taxType', 'base',
    'fiscalCategory', 'gravado',
    'ratePercent', 18,
    'rate', 0.18,
    'baseAmount', round(("quantity"::numeric * coalesce("unitPrice"::numeric, 0)), 2),
    'amount', round(("quantity"::numeric * coalesce("unitPrice"::numeric, 0)) * 0.18, 2),
    'displayOrder', 30
  ))
  ELSE '[]'::jsonb
END
WHERE "taxBreakdown" = '[]'::jsonb;

UPDATE "purchaseOrderItems"
SET
  "taxCode" = 'isv_4',
  "additionalTaxCodes" = '[]'::jsonb,
  "taxBreakdown" = jsonb_build_array(jsonb_build_object(
    'taxCode', 'isv_4',
    'label', 'ISV 4%',
    'shortLabel', 'ISV 4%',
    'taxType', 'base',
    'fiscalCategory', 'gravado',
    'ratePercent', 4,
    'rate', 0.04,
    'baseAmount', round(("quantity"::numeric * coalesce("unitPrice"::numeric, 0)), 2),
    'amount', round(("quantity"::numeric * coalesce("unitPrice"::numeric, 0)) * 0.04, 2),
    'displayOrder', 40
  )),
  "updatedAt" = now()
WHERE
  "taxCode" = 'isv_4'
  OR "additionalTaxCodes" @> '["isv_4"]'::jsonb;

UPDATE "invoiceItems"
SET "taxBreakdown" = CASE
  WHEN "taxCode" = 'isv_15' THEN jsonb_build_array(jsonb_build_object(
    'taxCode', 'isv_15',
    'label', 'ISV 15%',
    'shortLabel', 'ISV 15%',
    'taxType', 'base',
    'fiscalCategory', 'gravado',
    'ratePercent', 15,
    'rate', 0.15,
    'baseAmount', coalesce("subtotal"::numeric, 0),
    'amount', coalesce("taxAmount"::numeric, 0),
    'displayOrder', 20
  ))
  WHEN "taxCode" = 'isv_18' THEN jsonb_build_array(jsonb_build_object(
    'taxCode', 'isv_18',
    'label', 'ISV 18%',
    'shortLabel', 'ISV 18%',
    'taxType', 'base',
    'fiscalCategory', 'gravado',
    'ratePercent', 18,
    'rate', 0.18,
    'baseAmount', coalesce("subtotal"::numeric, 0),
    'amount', coalesce("taxAmount"::numeric, 0),
    'displayOrder', 30
  ))
  ELSE '[]'::jsonb
END
WHERE "taxBreakdown" = '[]'::jsonb;

UPDATE "invoiceItems"
SET
  "taxCode" = 'isv_4',
  "additionalTaxCodes" = '[]'::jsonb,
  "taxAmount" = round(coalesce("subtotal"::numeric, 0) * 0.04, 2),
  "total" = round(coalesce("subtotal"::numeric, 0) * 1.04, 2),
  "taxBreakdown" = jsonb_build_array(jsonb_build_object(
    'taxCode', 'isv_4',
    'label', 'ISV 4%',
    'shortLabel', 'ISV 4%',
    'taxType', 'base',
    'fiscalCategory', 'gravado',
    'ratePercent', 4,
    'rate', 0.04,
    'baseAmount', coalesce("subtotal"::numeric, 0),
    'amount', round(coalesce("subtotal"::numeric, 0) * 0.04, 2),
    'displayOrder', 40
  ))
WHERE
  "taxCode" = 'isv_4'
  OR "additionalTaxCodes" @> '["isv_4"]'::jsonb;

UPDATE "invoices" invoice
SET
  "subtotal" = totals."subtotal",
  "taxAmount" = totals."taxAmount",
  "total" = totals."total",
  "netPayable" = totals."total" - invoice."retentionTotal"::numeric,
  "updatedAt" = now()
FROM (
  SELECT
    "invoiceId",
    round(sum("subtotal"::numeric), 2) AS "subtotal",
    round(sum("taxAmount"::numeric), 2) AS "taxAmount",
    round(sum("total"::numeric), 2) AS "total"
  FROM "invoiceItems"
  GROUP BY "invoiceId"
) totals
WHERE invoice."id" = totals."invoiceId";
