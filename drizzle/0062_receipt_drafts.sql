DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'borrador'
      AND enumtypid = 'receipt_status'::regtype
  ) THEN
    ALTER TYPE "receipt_status" ADD VALUE 'borrador' BEFORE 'pendiente';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "rec_draft_source_idx"
  ON "receipts" ("sourceType", "sourceId", "projectId", "status");
