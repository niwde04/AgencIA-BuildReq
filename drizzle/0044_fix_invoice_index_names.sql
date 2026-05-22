CREATE INDEX IF NOT EXISTS "invoice_project_idx"
ON "invoices" ("projectId");

CREATE INDEX IF NOT EXISTS "invoice_status_idx"
ON "invoices" ("status");
