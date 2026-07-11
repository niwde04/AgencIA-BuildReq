import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("invoice retention fiscal data migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0107_invoice_retention_fiscal_data.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds nullable retention fiscal fields for historical invoices", () => {
    for (const column of [
      "retentionCai",
      "retentionDocumentRangeStart",
      "retentionDocumentRangeEnd",
      "retentionEmissionDeadline",
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration.toLowerCase()).not.toContain("not null");
  });
});
