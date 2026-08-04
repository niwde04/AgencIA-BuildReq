import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("purchase order issued-at migration and filters", () => {
  const migration = readFileSync(
    new URL("../drizzle/0135_purchase_order_issued_at.sql", import.meta.url),
    "utf8"
  );
  const schema = readFileSync(
    new URL("../drizzle/schema.ts", import.meta.url),
    "utf8"
  );
  const databaseSource = readFileSync(
    new URL("./db.ts", import.meta.url),
    "utf8"
  );
  const paginationSource = readFileSync(
    new URL("./paginatedLists.ts", import.meta.url),
    "utf8"
  );
  const routerSource = readFileSync(
    new URL("./routers/purchaseOrders.ts", import.meta.url),
    "utf8"
  );
  const pageSource = readFileSync(
    new URL("../client/src/pages/OrdenesCompra.tsx", import.meta.url),
    "utf8"
  );

  it("stores and indexes the official emission date", () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "issuedAt" timestamp'
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "po_issued_at_idx"'
    );
    expect(migration).toContain('WHERE "issuedAt" IS NOT NULL');
    expect(schema).toContain('issuedAt: timestamp("issuedAt")');
    expect(schema).toContain('index("po_issued_at_idx")');
  });

  it("backfills emitted or digitally sealed orders without dating drafts", () => {
    for (const status of [
      "emitida",
      "enviada",
      "parcialmente_recibida",
      "recibida",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain('FROM "purchaseOrderDigitalSeals" AS seal');
    expect(migration).toContain('po."printedAt"');
    expect(migration).toContain('po."issuedAt" IS NULL');
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("records issuedAt atomically and filters the paginated query by it", () => {
    expect(databaseSource).toContain("issuedAt: sealedAt");
    expect(paginationSource).toContain(
      "gte(purchaseOrders.issuedAt, filters.emissionDateFrom)"
    );
    expect(paginationSource).toContain(
      "lte(purchaseOrders.issuedAt, filters.emissionDateTo)"
    );
    expect(routerSource).toContain("emissionDateFrom");
    expect(routerSource).toContain("emissionDateTo");
    expect(routerSource).toContain(
      "La fecha inicial de emisión no puede ser mayor que la fecha final"
    );
  });

  it("wires both date inputs, the table column, and the filtered export", () => {
    expect(pageSource).toContain('id="purchase-order-emission-from"');
    expect(pageSource).toContain('id="purchase-order-emission-to"');
    expect(pageSource).toContain("emissionDateFrom: emissionDateFromFilter");
    expect(pageSource).toContain("emissionDateTo: emissionDateToFilter");
    expect(pageSource).toContain("Fecha emisión");
    expect(pageSource).toContain("formatPrintDate(row.purchaseOrder.issuedAt)");
    expect(pageSource).toContain("dateFrom: emissionDateFromFilter || null");
    expect(pageSource).toContain("dateTo: emissionDateToFilter || null");
  });
});
