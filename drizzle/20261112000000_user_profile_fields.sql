BEGIN;

SET LOCAL lock_timeout = '5s';

-- Optional descriptive data only; authorization, existing rows and grants stay intact.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phone" varchar(50),
  ADD COLUMN IF NOT EXISTS "jobTitle" varchar(150),
  ADD COLUMN IF NOT EXISTS "identityNumber" varchar(50);

COMMIT;
