import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("procurement currency migration", () => {
  it("adds HNL defaults and validates USD snapshots on every document", () => {
    const sql = readFileSync(
      new URL("../drizzle/0108_procurement_currency.sql", import.meta.url),
      "utf8"
    );

    for (const table of ["purchaseOrders", "receipts", "invoices"]) {
      expect(sql).toContain(`alter table \"${table}\"`);
    }
    expect(sql.match(/default 'HNL'/g)).toHaveLength(3);
    expect(sql.match(/\"currency\" = 'USD'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/\"exchangeRate\" > 0/g)).toHaveLength(3);
    expect(sql).toContain("po_exchange_rate_check");
    expect(sql).toContain("receipt_exchange_rate_check");
    expect(sql).toContain("invoice_exchange_rate_check");
  });
});
