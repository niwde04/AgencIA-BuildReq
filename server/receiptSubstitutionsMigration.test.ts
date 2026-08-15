import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("receipt substitution migration", () => {
  it("adds snapshots, a stable received article reference, and normalized lookup", async () => {
    const migration = await readFile(
      new URL(
        "../drizzle/0137_receipt_item_substitutions.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(migration).toContain('"requestedSapItemCode" varchar(50)');
    expect(migration).toContain('"receivedArticleId" integer');
    expect(migration).toContain(
      '"isSubstitution" boolean NOT NULL DEFAULT false'
    );
    expect(migration).toContain('"sap_cat_normalized_brand_part_idx"');
    expect(migration).toContain("ON DELETE SET NULL");
  });
});
