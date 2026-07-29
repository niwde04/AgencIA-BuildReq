import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("retention fiscal document ranges migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0125_retention_fiscal_document_ranges.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("creates an indexed internal catalog for retention fiscal ranges", () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "retentionFiscalDocumentRanges"'
    );
    expect(migration).toContain('"ret_fiscal_range_lookup_idx"');
    expect(migration).toContain('"ret_fiscal_range_source_invoice_idx"');
    expect(migration).toContain('"ret_fiscal_range_unique_idx"');
    expect(migration).toContain('"ret_fiscal_range_order_check"');
  });

  it("backfills valid ranges from historical invoice retentions", () => {
    for (const field of [
      "retentionReceiptNumber",
      "retentionCai",
      "retentionDocumentRangeStart",
      "retentionDocumentRangeEnd",
      "retentionEmissionDeadline",
    ]) {
      expect(migration).toContain(`i."${field}"`);
    }
    expect(migration).toContain("length(document_range_start_key) = 16");
    expect(migration).toContain(
      "document_range_start_key <= document_range_end_key"
    );
    expect(migration).toContain(
      "receipt_number_key BETWEEN"
    );
  });

  it("keeps the internal catalog outside direct Data API access", () => {
    expect(migration).toContain(
      'ALTER TABLE "retentionFiscalDocumentRanges" ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE "retentionFiscalDocumentRanges" FROM anon'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE "retentionFiscalDocumentRanges" FROM authenticated'
    );
  });
});
