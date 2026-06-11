ALTER TABLE "warehouseUserAssignments"
  ADD COLUMN IF NOT EXISTS "assignmentSource" varchar(30) DEFAULT 'manual' NOT NULL;

UPDATE "warehouseUserAssignments"
SET "assignmentSource" = 'manual'
WHERE "assignmentSource" IS NULL;

CREATE INDEX IF NOT EXISTS "wua_assignment_source_idx"
  ON "warehouseUserAssignments" USING btree ("assignmentSource");
