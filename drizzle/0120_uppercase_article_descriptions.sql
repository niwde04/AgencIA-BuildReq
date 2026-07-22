-- Normaliza las descripciones del catálogo e inventario y garantiza la regla
-- para todas las escrituras futuras, incluyendo importaciones directas.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

UPDATE "sapCatalog"
SET "description" = upper("description")
WHERE "description" <> upper("description");

UPDATE "inventoryItems"
SET
  "name" = upper("name"),
  "description" = CASE
    WHEN "description" IS NULL THEN NULL
    ELSE upper("description")
  END
WHERE
  "name" <> upper("name")
  OR (
    "description" IS NOT NULL
    AND "description" <> upper("description")
  );

CREATE OR REPLACE FUNCTION public.normalize_sap_catalog_description_uppercase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW."description" := upper(NEW."description");
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_sap_catalog_description_uppercase()
FROM PUBLIC;

DROP TRIGGER IF EXISTS "sap_catalog_description_uppercase_trigger"
ON "sapCatalog";

CREATE TRIGGER "sap_catalog_description_uppercase_trigger"
BEFORE INSERT OR UPDATE OF "description" ON "sapCatalog"
FOR EACH ROW
EXECUTE FUNCTION public.normalize_sap_catalog_description_uppercase();

CREATE OR REPLACE FUNCTION public.normalize_inventory_description_uppercase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW."name" := upper(NEW."name");
  IF NEW."description" IS NOT NULL THEN
    NEW."description" := upper(NEW."description");
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_inventory_description_uppercase()
FROM PUBLIC;

DROP TRIGGER IF EXISTS "inventory_description_uppercase_trigger"
ON "inventoryItems";

CREATE TRIGGER "inventory_description_uppercase_trigger"
BEFORE INSERT OR UPDATE OF "name", "description" ON "inventoryItems"
FOR EACH ROW
EXECUTE FUNCTION public.normalize_inventory_description_uppercase();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sap_catalog_description_uppercase_check'
      AND conrelid = '"sapCatalog"'::regclass
  ) THEN
    ALTER TABLE "sapCatalog"
      ADD CONSTRAINT "sap_catalog_description_uppercase_check"
      CHECK ("description" = upper("description"));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_name_uppercase_check'
      AND conrelid = '"inventoryItems"'::regclass
  ) THEN
    ALTER TABLE "inventoryItems"
      ADD CONSTRAINT "inventory_name_uppercase_check"
      CHECK ("name" = upper("name"));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_description_uppercase_check'
      AND conrelid = '"inventoryItems"'::regclass
  ) THEN
    ALTER TABLE "inventoryItems"
      ADD CONSTRAINT "inventory_description_uppercase_check"
      CHECK (
        "description" IS NULL
        OR "description" = upper("description")
      );
  END IF;
END $$;
