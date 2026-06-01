CREATE TABLE IF NOT EXISTS "userProjectAssignments" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "upa_user_idx"
  ON "userProjectAssignments" ("userId");

CREATE INDEX IF NOT EXISTS "upa_project_idx"
  ON "userProjectAssignments" ("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "upa_user_project_unique"
  ON "userProjectAssignments" ("userId", "projectId");

CREATE TABLE IF NOT EXISTS "invitationProjectAssignments" (
  "id" serial PRIMARY KEY,
  "invitationId" integer NOT NULL REFERENCES "invitations"("id") ON DELETE CASCADE,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ipa_invitation_idx"
  ON "invitationProjectAssignments" ("invitationId");

CREATE INDEX IF NOT EXISTS "ipa_project_idx"
  ON "invitationProjectAssignments" ("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "ipa_invitation_project_unique"
  ON "invitationProjectAssignments" ("invitationId", "projectId");

INSERT INTO "userProjectAssignments" ("userId", "projectId")
SELECT "id", "assignedProjectId"
FROM "users"
WHERE "assignedProjectId" IS NOT NULL
ON CONFLICT ("userId", "projectId") DO NOTHING;

INSERT INTO "invitationProjectAssignments" ("invitationId", "projectId")
SELECT "id", "assignedProjectId"
FROM "invitations"
WHERE "assignedProjectId" IS NOT NULL
ON CONFLICT ("invitationId", "projectId") DO NOTHING;
