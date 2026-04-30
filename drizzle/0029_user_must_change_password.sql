ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean DEFAULT false NOT NULL;
