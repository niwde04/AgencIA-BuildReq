DO $$
BEGIN
  ALTER TYPE "request_status" ADD VALUE 'pendiente_aprobar';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE "materialRequests"
SET "status" = 'pendiente_aprobar'
WHERE "status" = 'en_espera'
  AND "approvalStatus" = 'pendiente';
