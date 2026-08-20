import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("article base unit migration", () => {
  const migration = readFileSync(
    new URL("../drizzle/0138_article_base_unit.sql", import.meta.url),
    "utf8"
  );

  it("adds the nullable catalog unit without rewriting historical lines", () => {
    expect(migration).toContain(
      'ALTER TABLE "sapCatalog"\n  ADD COLUMN IF NOT EXISTS "unit" varchar(50)'
    );
    expect(migration).toContain("HAVING count(DISTINCT unit) = 1");
    expect(migration).toContain('UPDATE "sapCatalog" AS catalog');
    expect(migration).not.toMatch(
      /UPDATE\s+"(?:requestItems|purchaseOrderItems|receiptItems|inventoryItems)"/i
    );
  });
});
