-- Restore the catalog used by the existing default tax engine, by exact code.
-- Existing documents and their monetary/tax snapshots are never rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtextextended('buildreq:sales-tax-financial-groups:20260929035318', 0));

ALTER TABLE public."salesTaxes"
  ADD COLUMN IF NOT EXISTS "financialGroupCode" varchar(20);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."salesTaxes"'::regclass
      AND conname = 'sales_tax_financial_group_fk'
  ) THEN
    ALTER TABLE public."salesTaxes" ADD CONSTRAINT sales_tax_financial_group_fk
      FOREIGN KEY ("financialGroupCode") REFERENCES public."financialGroups" ("financialGroupCode")
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

INSERT INTO public."salesTaxes"
  ("taxCode", description, "shortLabel", "ratePercent", "taxType", "fiscalCategory", "isActive", "displayOrder", "appliesToTaxCodes", note, "erpCode")
VALUES
  ('exe', 'EXE - Exento', 'EXE', 0, 'base', 'exento', true, 10, '[]', 'Importe exento', 'EXE'),
  ('isv_15', 'ISV 15%', 'ISV 15%', 15, 'base', 'gravado', true, 20, '[]', 'Impuesto sobre ventas 15%', 'ISV15'),
  ('isv_18', 'ISV 18%', 'ISV 18%', 18, 'base', 'gravado', true, 30, '[]', 'Impuesto sobre ventas 18%', 'ISV18'),
  ('isv_4', 'ISV 4%', 'ISV 4%', 4, 'base', 'gravado', true, 40, '[]', 'Impuesto sobre ventas 4%', 'ISV4')
ON CONFLICT ("taxCode") DO NOTHING;

COMMIT;
