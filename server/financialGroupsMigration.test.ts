import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("financial groups migration", () => {
  const migration = readFileSync(
    new URL("../drizzle/0106_financial_groups.sql", import.meta.url),
    "utf8"
  );

  it("seeds exactly 23 unique groups with an idempotent upsert", () => {
    const valuesBlock =
      migration.match(/VALUES([\s\S]*?)ON CONFLICT/i)?.[1] ?? "";
    const codes = Array.from(valuesBlock.matchAll(/\('([0-9]{8})',/g)).map(
      match => match[1]
    );

    expect(codes).toHaveLength(23);
    expect(new Set(codes).size).toBe(23);
    expect(migration).toContain('ON CONFLICT ("financialGroupCode") DO UPDATE');
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "financialGroupCode"'
    );
    expect(migration).toContain("ON DELETE SET NULL");
  });
});
