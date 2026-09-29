-- Additive: existing invoices and their financial movements remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'pendiente_contabilizar';
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS "submittedForAccountingAt" timestamp,
  ADD COLUMN IF NOT EXISTS "submittedForAccountingById" integer;
COMMIT;
