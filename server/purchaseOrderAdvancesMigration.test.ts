import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("purchase order advances migration", () => {
  const migration = readFileSync(
    new URL("../drizzle/0126_purchase_order_advances.sql", import.meta.url),
    "utf8"
  );

  it("creates advances and FIFO application records", () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "purchaseOrderAdvances"'
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "purchaseOrderAdvanceApplications"'
    );
    expect(migration).toContain(
      '"po_advance_application_advance_invoice_unique"'
    );
    expect(migration).toContain('"amount" numeric(14,4) NOT NULL');
  });

  it("preserves historical batches and payments as invoice data", () => {
    expect(migration).toContain(
      '"paymentKind" "treasury_payment_kind"\n  DEFAULT \'invoice\' NOT NULL'
    );
    expect(migration).toContain(
      '"sourceType" "treasury_payment_source_type"\n  DEFAULT \'invoice\' NOT NULL'
    );
    expect(migration).not.toMatch(
      /UPDATE\s+"treasuryPaymentItems"[\s\S]*"previousPaidAmount"/i
    );
  });

  it("enforces one source reference and one active reservation", () => {
    expect(migration).toContain('"treasury_item_source_check"');
    expect(migration).toContain('"treasury_item_active_invoice_unique"');
    expect(migration).toContain('"treasury_item_active_advance_unique"');
    expect(migration).toContain(
      '"purchaseOrderAdvanceId" IS NULL'
    );
    expect(migration).toContain('"invoiceId" IS NULL');
  });

  it("keeps both new tables private from direct Data API roles", () => {
    for (const table of [
      "purchaseOrderAdvances",
      "purchaseOrderAdvanceApplications",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`
      );
      expect(migration).toContain(
        `REVOKE ALL ON TABLE "${table}" FROM anon, authenticated`
      );
    }
  });
});
