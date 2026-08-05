BEGIN;

-- BuildReq exposes authentication through Supabase, but all business data is
-- accessed by the application server over its direct PostgreSQL connection.
-- Keep the public schema discoverable by Supabase while removing direct Data
-- API privileges from browser-facing roles.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Drizzle migrations connect as postgres, so prevent future objects created by
-- that role from inheriting Supabase's legacy public Data API grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Some Supabase environments allow postgres to administer the defaults owned
-- by supabase_admin. Tighten them when that membership is available; the event
-- trigger below remains the fail-closed guard in environments where it is not.
DO $$
BEGIN
  IF pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE
      'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
      'REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated';
    EXECUTE
      'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
      'REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated';
    EXECUTE
      'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
      'REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

-- RLS is defense in depth. It is deliberately enabled, not forced: the
-- postgres backend role owns these tables and has BYPASSRLS.
DO $$
DECLARE
  target_table record;
BEGIN
  FOR target_table IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_class AS relation
    INNER JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target_table.schema_name,
      target_table.table_name
    );
  END LOOP;
END;
$$;

-- Keep the automatic guard outside every schema exposed through PostgREST.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL PRIVILEGES ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.buildreq_enable_rls_on_new_public_tables()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  command record;
BEGIN
  FOR command IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF command.schema_name = 'public' THEN
      EXECUTE format(
        'ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY',
        command.object_identity
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated',
        command.object_identity
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION private.buildreq_enable_rls_on_new_public_tables()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_event_trigger
    WHERE evtname = 'buildreq_ensure_public_table_rls'
  ) THEN
    EXECUTE $event_trigger$
      CREATE EVENT TRIGGER buildreq_ensure_public_table_rls
      ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION private.buildreq_enable_rls_on_new_public_tables()
    $event_trigger$;
  END IF;
END;
$$;

COMMIT;
