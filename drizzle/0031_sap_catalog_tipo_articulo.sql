ALTER TABLE "sapCatalog"
ADD COLUMN IF NOT EXISTS "tipoArticulo" integer DEFAULT 1 NOT NULL;

DO $$
BEGIN
  ALTER TABLE "sapCatalog"
  ADD CONSTRAINT "sapCatalog_tipoArticulo_check"
  CHECK ("tipoArticulo" IN (1, 2, 3));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "sap_cat_tipo_articulo_idx"
ON "sapCatalog" ("tipoArticulo");
