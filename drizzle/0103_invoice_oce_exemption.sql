ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "hasOceExemption" boolean DEFAULT false NOT NULL;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "oceResolutionNumber" varchar(100);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "oceResolutionDate" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "oceExemptAmount" decimal(14,4) DEFAULT '0.0000' NOT NULL;
