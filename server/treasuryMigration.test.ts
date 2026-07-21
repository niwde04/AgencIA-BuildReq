import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("treasury partial payments migration", () => {
  const migration = readFileSync(
    new URL("../drizzle/0116_treasury_partial_payments.sql", import.meta.url),
    "utf8"
  );

  it("creates the workflow, approver, line, and audit tables", () => {
    for (const table of [
      "treasuryApproverAssignments",
      "treasuryPaymentBatches",
      "treasuryPaymentItems",
      "treasuryPaymentEvents",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "treasuryEnabled" boolean DEFAULT false NOT NULL'
    );
  });

  it("prevents concurrent active reservations for the same invoice", () => {
    expect(migration).toContain('"treasury_item_active_invoice_unique"');
    expect(migration).toContain('WHERE "activeReservation" = true');
    expect(migration).toContain(
      '"invoiceId" integer NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT'
    );
  });

  it("keeps treasury tables private from direct Data API roles", () => {
    for (const table of [
      "treasuryApproverAssignments",
      "treasuryPaymentBatches",
      "treasuryPaymentItems",
      "treasuryPaymentEvents",
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
