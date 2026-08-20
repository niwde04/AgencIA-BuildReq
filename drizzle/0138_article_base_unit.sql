BEGIN;

ALTER TABLE "sapCatalog"
  ADD COLUMN IF NOT EXISTS "unit" varchar(50);

-- Preserve every historical document exactly as it was recorded. Only infer a
-- catalog base unit when all observations for that SAP code agree after
-- normalizing the known legacy aliases. Ambiguous codes remain NULL for review.
WITH observed_raw AS (
  SELECT "sapItemCode" AS code, unit
  FROM "requestItems"
  WHERE "sapItemCode" IS NOT NULL
    AND nullif(btrim(unit), '') IS NOT NULL

  UNION ALL

  SELECT coalesce("currentSapItemCode", "originalSapItemCode") AS code, unit
  FROM "purchaseOrderItems"
  WHERE coalesce("currentSapItemCode", "originalSapItemCode") IS NOT NULL
    AND nullif(btrim(unit), '') IS NOT NULL

  UNION ALL

  SELECT "sapItemCode" AS code, unit
  FROM "receiptItems"
  WHERE "sapItemCode" IS NOT NULL
    AND nullif(btrim(unit), '') IS NOT NULL

  UNION ALL

  SELECT "sapItemCode" AS code, unit
  FROM "inventoryItems"
  WHERE "sapItemCode" IS NOT NULL
    AND nullif(btrim(unit), '') IS NOT NULL
),
observed_normalized AS (
  SELECT
    code,
    CASE lower(btrim(unit))
      WHEN 'unidad' THEN 'und'
      WHEN 'unidades' THEN 'und'
      WHEN 'galon' THEN 'gal'
      WHEN 'galón' THEN 'gal'
      WHEN 'galones' THEN 'gal'
      WHEN 'libra' THEN 'lb'
      WHEN 'libras' THEN 'lb'
      WHEN 'litro' THEN 'lt'
      WHEN 'litros' THEN 'lt'
      WHEN 'metro' THEN 'm'
      WHEN 'metros' THEN 'm'
      WHEN 'pie' THEN 'ft'
      WHEN 'pies' THEN 'ft'
      WHEN 'kilogramo' THEN 'kg'
      WHEN 'kilogramos' THEN 'kg'
      WHEN 'tonelada' THEN 'ton'
      WHEN 'toneladas' THEN 'ton'
      ELSE lower(btrim(unit))
    END AS unit
  FROM observed_raw
  WHERE nullif(btrim(code), '') IS NOT NULL
),
consistent_units AS (
  SELECT code, min(unit) AS unit
  FROM observed_normalized
  GROUP BY code
  HAVING count(DISTINCT unit) = 1
)
UPDATE "sapCatalog" AS catalog
SET "unit" = consistent_units.unit
FROM consistent_units
WHERE catalog."itemCode" = consistent_units.code
  AND nullif(btrim(catalog."unit"), '') IS NULL;

COMMIT;
