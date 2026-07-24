DO $$
DECLARE
  legacy_catalog_id integer;
  canonical_catalog_id integer;
BEGIN
  SELECT "id"
  INTO canonical_catalog_id
  FROM "taxRetentions"
  WHERE upper(trim("taxCode")) = 'RT01'
    AND abs("ratePercent" - 1) < 0.000001
  ORDER BY "id"
  LIMIT 1
  FOR UPDATE;

  SELECT "id"
  INTO legacy_catalog_id
  FROM "taxRetentions"
  WHERE upper(trim("taxCode")) = 'RT1'
    AND abs("ratePercent" - 1) < 0.000001
  ORDER BY "id"
  LIMIT 1
  FOR UPDATE;

  IF legacy_catalog_id IS NOT NULL AND canonical_catalog_id IS NULL THEN
    UPDATE "taxRetentions"
    SET
      "taxCode" = 'RT01',
      "updatedAt" = now()
    WHERE "id" = legacy_catalog_id;

    canonical_catalog_id := legacy_catalog_id;
  ELSIF legacy_catalog_id IS NOT NULL
    AND canonical_catalog_id IS NOT NULL
    AND legacy_catalog_id <> canonical_catalog_id THEN
    UPDATE "invoiceRetentions"
    SET
      "retentionCatalogId" = canonical_catalog_id,
      "updatedAt" = now()
    WHERE "retentionCatalogId" = legacy_catalog_id;

    DELETE FROM "taxRetentions"
    WHERE "id" = legacy_catalog_id;
  END IF;

  UPDATE "invoiceRetentions"
  SET
    "retentionCode" = 'RT01',
    "retentionErpCode" = COALESCE(
      NULLIF(trim("retentionErpCode"), ''),
      'R01'
    ),
    "updatedAt" = now()
  WHERE abs(COALESCE("percentage", 0) - 1) < 0.000001
    AND (
      "retentionCatalogId" = canonical_catalog_id
      OR upper(trim(COALESCE("retentionCode", ''))) IN ('RT1', 'RT01')
    )
    AND (
      "retentionCode" IS DISTINCT FROM 'RT01'
      OR NULLIF(trim("retentionErpCode"), '') IS NULL
    );
END $$;
