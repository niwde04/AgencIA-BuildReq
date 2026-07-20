import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supplier fiscal invoice uniqueness migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0115_unique_supplier_fiscal_invoice.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("normalizes and scopes fiscal invoice numbers by supplier", () => {
    expect(migration).toContain('"supplierId"');
    expect(migration).toContain("regexp_replace");
    expect(migration).toContain("'[^0-9]'");
    expect(migration).toContain('"isFiscalDocument" = true');
    expect(migration).toContain('"status" <> \'anulada\'');
  });

  it("protects both receipt registration and invoice writes", () => {
    expect(migration).toContain(
      'CREATE TRIGGER "receipt_supplier_fiscal_invoice_number_unique"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "invoice_supplier_fiscal_invoice_number_unique"'
    );
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(migration).toContain(
      "CONSTRAINT = 'supplier_fiscal_invoice_number_unique'"
    );
  });
});
