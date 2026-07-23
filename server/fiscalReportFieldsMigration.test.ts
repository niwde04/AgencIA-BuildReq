import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("fiscal report fields migration", () => {
  const migration = readFileSync(
    new URL("../drizzle/0121_fiscal_report_fields.sql", import.meta.url),
    "utf8"
  );

  it("adds all invoice and line fields with constrained DMC domains", () => {
    for (const column of [
      "retentionDocumentDate",
      "oceNumber",
      "oceExemptAmount15",
      "oceExemptAmount18",
      "dmcForeignSection",
      "dmcForeignIdentification",
      "dmcFyducaNumber",
      "dmcDuaNumber",
      "dmcImportOutsideCentralAmerica",
      "dmcDestination",
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain("'fyduca', 'importacion'");
    expect(migration).toContain("'costo', 'gasto', 'no_deducible'");
  });

  it("backfills retention date in the required historical priority order", () => {
    expect(migration).toContain(
      'coalesce(\n  "documentDate",\n  "postingDate",\n  "receiptDate"\n)'
    );
    expect(migration).toContain('"retentionTotal" > 0');
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "invoice_retention_document_date_idx"'
    );
  });
});
