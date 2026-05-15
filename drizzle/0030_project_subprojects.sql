ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "startDate" timestamp;

ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "endDate" timestamp;

CREATE TABLE IF NOT EXISTS "projectSubprojects" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "code" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "startDate" timestamp,
  "endDate" timestamp,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "psp_project_idx"
ON "projectSubprojects" ("projectId");

CREATE INDEX IF NOT EXISTS "psp_active_idx"
ON "projectSubprojects" ("isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "psp_project_code_unique"
ON "projectSubprojects" ("projectId", "code");
