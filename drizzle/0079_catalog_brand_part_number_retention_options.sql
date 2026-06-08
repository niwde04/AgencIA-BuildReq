ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "brand" varchar(120);

ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "partNumber" varchar(120);

CREATE INDEX IF NOT EXISTS "sap_cat_brand_idx"
ON "sapCatalog" ("brand");

CREATE INDEX IF NOT EXISTS "sap_cat_part_number_idx"
ON "sapCatalog" ("partNumber");

INSERT INTO "taxRetentions"
  ("taxCode", "description", "ratePercent", "isActive", "note", "erpCode")
VALUES
  ('RT10', 'Retención 10%', '10.0000', true, 'Opción paramétrica de retención 10%', 'R10'),
  ('RT25', 'Retención 25%', '25.0000', true, 'Opción paramétrica de retención 25%', 'R25')
ON CONFLICT ("taxCode") DO UPDATE SET
  "description" = EXCLUDED."description",
  "ratePercent" = EXCLUDED."ratePercent",
  "isActive" = true,
  "note" = EXCLUDED."note",
  "erpCode" = EXCLUDED."erpCode",
  "updatedAt" = now();
