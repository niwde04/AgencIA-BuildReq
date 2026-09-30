-- Additive catalog only. Run with scripts/migrate-cost-matrix.ts, never global db:push.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('buildreq:cost-matrix:migration'));
CREATE TABLE IF NOT EXISTS public."costMatrixEntries" (
  id serial PRIMARY KEY,
  "matrixCode" varchar(104) NOT NULL,
  "sourceKey" varchar(200),
  "jobCode" varchar(20) NOT NULL, "jobName" varchar(500) NOT NULL,
  n1 varchar(20) NOT NULL, nivel1 varchar(500) NOT NULL,
  n2 varchar(20) NOT NULL, nivel2 varchar(500) NOT NULL,
  n3 varchar(20) NOT NULL, nivel3 varchar(500) NOT NULL,
  n4 varchar(20) NOT NULL, nivel4 varchar(500) NOT NULL,
  "majorGroup" varchar(500) NOT NULL,
  "flowId" varchar(20) NOT NULL, "flowActivity" varchar(500) NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "createdById" integer REFERENCES public.users(id) ON DELETE SET NULL,
  "updatedById" integer REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT "costMatrixEntries_code_matches" CHECK (
    "matrixCode" = "jobCode" || '-' || n1 || '-' || n2 || '-' || n3 || '-' || n4
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "costMatrixEntries_matrixCode_unique" ON public."costMatrixEntries"("matrixCode");
CREATE UNIQUE INDEX IF NOT EXISTS "costMatrixEntries_sourceKey_unique" ON public."costMatrixEntries"("sourceKey");
CREATE INDEX IF NOT EXISTS "costMatrixEntries_filters_idx" ON public."costMatrixEntries"("jobCode", n1, "isActive");
ALTER TABLE public."costMatrixEntries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."costMatrixEntries" FROM PUBLIC;
REVOKE ALL ON SEQUENCE public."costMatrixEntries_id_seq" FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."costMatrixEntries" FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE public."costMatrixEntries_id_seq" FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
COMMIT;
