CREATE TABLE IF NOT EXISTS "taxRetentions" (
  "id" serial PRIMARY KEY,
  "taxCode" varchar(50) NOT NULL,
  "description" varchar(200) NOT NULL,
  "ratePercent" decimal(8,4) NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "note" text,
  "erpCode" varchar(50),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tax_ret_tax_code_idx"
ON "taxRetentions" ("taxCode");

CREATE INDEX IF NOT EXISTS "tax_ret_active_idx"
ON "taxRetentions" ("isActive");

INSERT INTO "taxRetentions"
  ("taxCode", "description", "ratePercent", "isActive", "note", "erpCode")
VALUES
  ('RT01', 'Retención 1%', '1.0000', true, 'Base a ley x y o z', 'R01'),
  ('RT125', 'Retención 12.5%', '12.5000', true, 'Base a ley x y o z', 'R12'),
  ('RT15', 'Retención 15%', '15.0000', true, 'Base a ley x y o z', 'R15'),
  ('RT25', 'Retención 25%', '25.0000', false, 'Base a ley x y o z', 'R25')
ON CONFLICT ("taxCode") DO UPDATE SET
  "description" = EXCLUDED."description",
  "ratePercent" = EXCLUDED."ratePercent",
  "isActive" = EXCLUDED."isActive",
  "note" = EXCLUDED."note",
  "erpCode" = EXCLUDED."erpCode",
  "updatedAt" = now();

ALTER TABLE "invoiceRetentions"
ADD COLUMN IF NOT EXISTS "retentionCatalogId" integer;

ALTER TABLE "invoiceRetentions"
ADD COLUMN IF NOT EXISTS "retentionCode" varchar(50);

ALTER TABLE "invoiceRetentions"
ADD COLUMN IF NOT EXISTS "retentionErpCode" varchar(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoiceRetentions_retentionCatalogId_taxRetentions_id_fk'
  ) THEN
    ALTER TABLE "invoiceRetentions"
    ADD CONSTRAINT "invoiceRetentions_retentionCatalogId_taxRetentions_id_fk"
    FOREIGN KEY ("retentionCatalogId")
    REFERENCES "taxRetentions"("id")
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invr_retention_catalog_idx"
ON "invoiceRetentions" USING btree ("retentionCatalogId");
