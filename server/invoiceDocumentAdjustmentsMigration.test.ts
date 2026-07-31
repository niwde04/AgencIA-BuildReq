import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("invoice document adjustments migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0127_invoice_document_adjustments.sql",
      import.meta.url
    ),
    "utf8"
  );
  const amountInputMigration = readFileSync(
    new URL(
      "../drizzle/0130_invoice_document_adjustment_amount_input.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds aggregate invoice totals and the private adjustment table", () => {
    expect(migration).toContain('"otherRetentionTotal" numeric(14,4)');
    expect(migration).toContain('"documentDiscountTotal" numeric(14,4)');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "invoiceDocumentAdjustments"'
    );
    expect(migration).toContain('"invda_invoice_type_unique"');
  });

  it("validates types, percentages, amounts and cascade ownership", () => {
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain('"invda_adjustment_type_check"');
    expect(migration).toContain('"invda_percentage_check"');
    expect(migration).toContain('"invda_amount_check"');
  });

  it("keeps adjustments private from direct Data API roles", () => {
    expect(migration).toContain(
      'ALTER TABLE "invoiceDocumentAdjustments" ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE "invoiceDocumentAdjustments" FROM anon, authenticated'
    );
  });

  it("supports amount-origin adjustments without rounding away the amount", () => {
    expect(amountInputMigration).toContain('"inputMode" varchar(20)');
    expect(amountInputMigration).toContain(
      'ALTER COLUMN "percentage" TYPE numeric(11,8)'
    );
    expect(amountInputMigration).toContain('"invda_input_mode_check"');
    expect(amountInputMigration).toContain('"invda_amount_within_base_check"');
  });
});
