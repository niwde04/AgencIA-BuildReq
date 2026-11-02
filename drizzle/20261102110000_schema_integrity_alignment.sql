-- Reconcile schema.ts with migrations 0010, 0018, 0061, 0062 and 0132.
-- Additive only: preserve historical rows, existing equivalent constraints,
-- permissions, RLS, legacy advances and the retired opening-balance folio.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261102, 110000);

DO $$
DECLARE
  spec record;
  child_oid regclass;
  parent_oid regclass;
  child_column smallint;
  parent_column smallint;
  delete_code "char";
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('warehouseExits', 'projectId', 'projects', 'id', 'warehouseExits_projectId_projects_id_fk', 'RESTRICT'),
      ('warehouseExits', 'createdById', 'users', 'id', 'warehouseExits_createdById_users_id_fk', 'RESTRICT'),
      ('warehouseExitItems', 'warehouseExitId', 'warehouseExits', 'id', 'warehouseExitItems_warehouseExitId_warehouseExits_id_fk', 'CASCADE'),
      ('openingBalances', 'projectId', 'projects', 'id', 'openingBalances_projectId_projects_id_fk', 'RESTRICT'),
      ('openingBalances', 'warehouseId', 'warehouses', 'id', 'openingBalances_warehouseId_warehouses_id_fk', 'RESTRICT'),
      ('openingBalances', 'createdById', 'users', 'id', 'openingBalances_createdById_users_id_fk', 'RESTRICT'),
      ('openingBalanceItems', 'openingBalanceId', 'openingBalances', 'id', 'openingBalanceItems_openingBalanceId_openingBalances_id_fk', 'CASCADE')
    ) AS expected(child_table, child_field, parent_table, parent_field, constraint_name, delete_action)
  LOOP
    child_oid := to_regclass(format('public.%I', spec.child_table));
    parent_oid := to_regclass(format('public.%I', spec.parent_table));
    IF child_oid IS NULL OR parent_oid IS NULL THEN
      RAISE EXCEPTION 'Falta una tabla base para alinear %.%', spec.child_table, spec.child_field;
    END IF;
    SELECT attnum INTO child_column FROM pg_attribute
      WHERE attrelid = child_oid AND attname = spec.child_field AND NOT attisdropped;
    SELECT attnum INTO parent_column FROM pg_attribute
      WHERE attrelid = parent_oid AND attname = spec.parent_field AND NOT attisdropped;
    IF child_column IS NULL OR parent_column IS NULL THEN
      RAISE EXCEPTION 'Falta una columna base para alinear %.%', spec.child_table, spec.child_field;
    END IF;
    delete_code := CASE spec.delete_action WHEN 'CASCADE' THEN 'c' ELSE 'r' END;

    -- A reused name must describe exactly this relation, not hide a mismatch.
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = child_oid AND c.conname = spec.constraint_name
        AND NOT (
          c.contype = 'f' AND c.conkey = ARRAY[child_column]::smallint[]
          AND c.confrelid = parent_oid AND c.confkey = ARRAY[parent_column]::smallint[]
          AND c.confdeltype = delete_code AND c.confupdtype = 'a'
          AND c.confmatchtype = 's' AND NOT c.condeferrable
        )
    ) THEN
      RAISE EXCEPTION 'La restricción % tiene una definición inesperada', spec.constraint_name;
    END IF;

    -- Recognize equivalent foreign keys even when an environment renamed them.
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = child_oid AND c.contype = 'f'
        AND c.conkey = ARRAY[child_column]::smallint[]
        AND c.confrelid = parent_oid AND c.confkey = ARRAY[parent_column]::smallint[]
        AND c.confdeltype = delete_code AND c.confupdtype = 'a'
        AND c.confmatchtype = 's' AND NOT c.condeferrable
    ) THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = child_oid AND c.contype = 'f'
        AND c.conkey = ARRAY[child_column]::smallint[]
    ) THEN
      RAISE EXCEPTION 'La relación de %.% requiere revisión; no se reemplazará automáticamente', spec.child_table, spec.child_field;
    END IF;

    -- Enforce future writes without scanning or rewriting unverified history.
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (%I) ON DELETE %s ON UPDATE NO ACTION NOT VALID',
      spec.child_table, spec.constraint_name, spec.child_field,
      spec.parent_table, spec.parent_field, spec.delete_action
    );
  END LOOP;
END $$;

DO $$
DECLARE
  spec record;
  table_oid regclass;
  index_oid regclass;
  actual_columns text[];
  actual_descending boolean[];
  column_sql text;
  definition record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('purchaseOrderItems', 'poi_fixed_asset_status_idx', ARRAY['fixedAssetStatus']::text[], ARRAY[false]),
      ('receipts', 'rec_draft_source_idx', ARRAY['sourceType', 'sourceId', 'projectId', 'status']::text[], ARRAY[false, false, false, false]),
      ('warehouseExits', 'we_created_page_idx', ARRAY['createdAt', 'id']::text[], ARRAY[true, true])
    ) AS expected(table_name, index_name, columns, descending_flags)
  LOOP
    table_oid := to_regclass(format('public.%I', spec.table_name));
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla base del índice %', spec.index_name;
    END IF;
    index_oid := to_regclass(format('public.%I', spec.index_name));
    IF index_oid IS NULL THEN
      SELECT string_agg(format('%I%s', col, CASE WHEN spec.descending_flags[pos] THEN ' DESC' ELSE '' END), ', ' ORDER BY pos)
      INTO column_sql
      FROM unnest(spec.columns) WITH ORDINALITY AS fields(col, pos);
      EXECUTE format('CREATE INDEX %I ON public.%I USING btree (%s)', spec.index_name, spec.table_name, column_sql);
      index_oid := to_regclass(format('public.%I', spec.index_name));
    END IF;

    SELECT i.*, a.amname INTO definition
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am a ON a.oid = c.relam
    WHERE i.indexrelid = index_oid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El nombre % existe y no es un índice', spec.index_name;
    END IF;
    SELECT array_agg(a.attname::text ORDER BY fields.pos)
    INTO actual_columns
    FROM unnest(definition.indkey) WITH ORDINALITY AS fields(attnum, pos)
    JOIN pg_attribute a ON a.attrelid = table_oid AND a.attnum = fields.attnum;
    SELECT array_agg((flags & 1) = 1 ORDER BY pos)
    INTO actual_descending
    FROM unnest(definition.indoption) WITH ORDINALITY AS options(flags, pos);
    IF definition.indrelid <> table_oid OR definition.amname <> 'btree'
      OR NOT definition.indisvalid OR NOT definition.indisready
      OR definition.indisunique OR definition.indpred IS NOT NULL
      OR definition.indexprs IS NOT NULL
      OR definition.indnkeyatts <> cardinality(spec.columns)
      OR definition.indnatts <> cardinality(spec.columns)
      OR actual_columns IS DISTINCT FROM spec.columns
      OR actual_descending IS DISTINCT FROM spec.descending_flags THEN
      RAISE EXCEPTION 'El índice % tiene una definición inesperada; no se reemplazará automáticamente', spec.index_name;
    END IF;
  END LOOP;
END $$;
COMMIT;
