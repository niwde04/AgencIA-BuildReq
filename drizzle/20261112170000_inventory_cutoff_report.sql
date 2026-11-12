BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public."inventoryReportSnapshots" (
  id serial PRIMARY KEY,
  "sourceKey" text NOT NULL UNIQUE,
  "sourceHash" text NOT NULL CONSTRAINT irs_source_hash_check CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  "capturedAt" timestamptz NOT NULL,
  kind text NOT NULL CONSTRAINT irs_kind_check CHECK (kind IN ('backup', 'activation')),
  "rowsCount" integer NOT NULL CONSTRAINT irs_rows_count_check CHECK ("rowsCount" >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT irs_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public."inventoryReportSnapshotRows" (
  id serial PRIMARY KEY,
  "snapshotId" integer NOT NULL REFERENCES public."inventoryReportSnapshots"(id) ON DELETE RESTRICT,
  "inventoryItemId" integer NOT NULL CONSTRAINT irsr_item_id_check CHECK ("inventoryItemId" > 0),
  "rowData" jsonb NOT NULL CONSTRAINT irsr_row_data_check CHECK (
    jsonb_typeof("rowData") = 'object'
    AND "rowData"->>'id' IS NOT NULL
    AND "rowData"->>'id' = "inventoryItemId"::text
  ),
  UNIQUE ("snapshotId", "inventoryItemId")
);

CREATE TABLE IF NOT EXISTS public."inventoryReportStockChanges" (
  id bigserial PRIMARY KEY,
  "changedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "inventoryItemId" integer NOT NULL CONSTRAINT irsc_item_id_check CHECK ("inventoryItemId" > 0),
  "beforeRow" jsonb,
  "afterRow" jsonb,
  CONSTRAINT irsc_nonempty_check CHECK ("beforeRow" IS NOT NULL OR "afterRow" IS NOT NULL),
  CONSTRAINT irsc_before_row_check CHECK ("beforeRow" IS NULL OR (
    jsonb_typeof("beforeRow") = 'object'
    AND "beforeRow"->>'id' IS NOT NULL
    AND "beforeRow"->>'id' = "inventoryItemId"::text
  )),
  CONSTRAINT irsc_after_row_check CHECK ("afterRow" IS NULL OR (
    jsonb_typeof("afterRow") = 'object'
    AND "afterRow"->>'id' IS NOT NULL
    AND "afterRow"->>'id' = "inventoryItemId"::text
  ))
);

CREATE INDEX IF NOT EXISTS inventory_report_snapshots_captured_idx
  ON public."inventoryReportSnapshots" ("capturedAt", id);
CREATE INDEX IF NOT EXISTS inventory_report_stock_changes_time_idx
  ON public."inventoryReportStockChanges" ("changedAt", id);
CREATE INDEX IF NOT EXISTS inventory_report_stock_changes_item_idx
  ON public."inventoryReportStockChanges" ("inventoryItemId", id);

ALTER TABLE public."inventoryReportSnapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventoryReportSnapshotRows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventoryReportStockChanges" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.inventory_report_history_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'El historial de inventario es inmutable.' USING ERRCODE = '23514';
END;
$function$;

CREATE OR REPLACE FUNCTION private.capture_inventory_report_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  -- A timestamp touch alone does not change the report's state.
  IF TG_OP = 'UPDATE' AND
     (to_jsonb(OLD) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  INSERT INTO public."inventoryReportStockChanges" (
    "changedAt", "inventoryItemId", "beforeRow", "afterRow"
  ) VALUES (
    clock_timestamp(),
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.inventory_report_history_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.capture_inventory_report_stock_change() FROM PUBLIC;

DO $permissions$
DECLARE
  role_name text;
  table_name text;
  sequence_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventoryReportSnapshots', 'inventoryReportSnapshotRows', 'inventoryReportStockChanges'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
  FOREACH sequence_name IN ARRAY ARRAY[
    'inventoryReportSnapshots_id_seq', 'inventoryReportSnapshotRows_id_seq', 'inventoryReportStockChanges_id_seq'
  ] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC', sequence_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', sequence_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.inventory_report_history_immutable() FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION private.capture_inventory_report_stock_change() FROM %I', role_name);
    END IF;
  END LOOP;
END;
$permissions$;

-- Wait for prior stock writers, then install capture and take the opening in
-- the same transaction. Readers may continue; stock quantities are never edited.
LOCK TABLE public."inventoryItems" IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS inventory_report_stock_change_capture ON public."inventoryItems";
CREATE TRIGGER inventory_report_stock_change_capture
AFTER INSERT OR UPDATE OR DELETE ON public."inventoryItems"
FOR EACH ROW EXECUTE FUNCTION private.capture_inventory_report_stock_change();

DROP TRIGGER IF EXISTS inventory_report_block_stock_truncate ON public."inventoryItems";
CREATE TRIGGER inventory_report_block_stock_truncate
BEFORE TRUNCATE ON public."inventoryItems"
FOR EACH STATEMENT EXECUTE FUNCTION private.inventory_report_history_immutable();

DO $immutable$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventoryReportSnapshots', 'inventoryReportSnapshotRows', 'inventoryReportStockChanges'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS inventory_report_history_immutable ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER inventory_report_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.inventory_report_history_immutable()',
      table_name
    );
  END LOOP;
END;
$immutable$;

DO $opening$
DECLARE
  snapshot_id integer;
  captured_at timestamptz;
  row_count integer;
  source_hash text;
BEGIN
  SELECT id INTO snapshot_id FROM public."inventoryReportSnapshots" WHERE "sourceKey" = 'activation-v1';
  IF snapshot_id IS NULL THEN
    captured_at := clock_timestamp();
    SELECT count(*)::integer,
      encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text, E'\n' ORDER BY i.id), ''), 'UTF8')), 'hex')
      INTO row_count, source_hash
    FROM public."inventoryItems" i;
    INSERT INTO public."inventoryReportSnapshots" ("sourceKey", "sourceHash", "capturedAt", kind, "rowsCount", metadata)
    VALUES ('activation-v1', source_hash, captured_at, 'activation', row_count, '{}')
    RETURNING id INTO snapshot_id;
    INSERT INTO public."inventoryReportSnapshotRows" ("snapshotId", "inventoryItemId", "rowData")
    SELECT snapshot_id, i.id, to_jsonb(i) FROM public."inventoryItems" i ORDER BY i.id;
  END IF;
END;
$opening$;

COMMIT;
