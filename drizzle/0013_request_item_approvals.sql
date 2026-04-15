ALTER TABLE "requestItems"
  ADD COLUMN IF NOT EXISTS "approvalStatus" "approval_status" DEFAULT 'no_requiere' NOT NULL,
  ADD COLUMN IF NOT EXISTS "approvedById" integer,
  ADD COLUMN IF NOT EXISTS "approvedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "rejectionReason" text;

UPDATE "requestItems"
SET "approvalStatus" = COALESCE("approvalStatus", 'no_requiere');
