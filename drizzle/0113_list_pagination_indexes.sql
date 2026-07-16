-- Índices de orden estable para las listas operativas paginadas.
CREATE INDEX IF NOT EXISTS "mr_created_page_idx"
  ON "materialRequests" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "sfr_created_page_idx"
  ON "supplyFlowRecords" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "pr_created_page_idx"
  ON "purchaseRequests" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "po_created_page_idx"
  ON "purchaseOrders" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "tr_created_page_idx"
  ON "transferRequests" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "tf_created_page_idx"
  ON "transfers" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "rec_created_page_idx"
  ON "receipts" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "inv_created_page_idx"
  ON "invoices" ("createdAt" DESC, "id" DESC);

-- Filtros de estado faltantes en recepciones e historial de flujos.
CREATE INDEX IF NOT EXISTS "rec_status_idx" ON "receipts" ("status");
CREATE INDEX IF NOT EXISTS "sfr_status_idx" ON "supplyFlowRecords" ("status");
