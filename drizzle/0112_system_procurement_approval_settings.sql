-- Interruptores globales de aprobación administrados solo por el servidor.
CREATE TABLE IF NOT EXISTS "systemSettings" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "purchaseRequestApprovalsEnabled" boolean NOT NULL DEFAULT false,
  "purchaseOrderApprovalsEnabled" boolean NOT NULL DEFAULT false,
  "updatedByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

INSERT INTO "systemSettings" ("id")
VALUES (1)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "systemSettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "systemSettings" FROM anon, authenticated;
