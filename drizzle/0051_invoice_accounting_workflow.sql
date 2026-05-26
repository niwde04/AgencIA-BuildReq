ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS 'contable';

ALTER TYPE "invoice_status" ADD VALUE IF NOT EXISTS 'revisada';

ALTER TYPE "attachment_entity_type" ADD VALUE IF NOT EXISTS 'invoice';

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "reviewedById" integer,
ADD COLUMN IF NOT EXISTS "reviewedAt" timestamp,
ADD COLUMN IF NOT EXISTS "accountedById" integer,
ADD COLUMN IF NOT EXISTS "accountedAt" timestamp,
ADD COLUMN IF NOT EXISTS "accountingComment" text,
ADD COLUMN IF NOT EXISTS "rejectionComment" text,
ADD COLUMN IF NOT EXISTS "rejectedById" integer,
ADD COLUMN IF NOT EXISTS "rejectedAt" timestamp;
