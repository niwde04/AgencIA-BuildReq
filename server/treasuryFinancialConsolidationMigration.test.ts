import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("treasury financial consolidation migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0117_treasury_financial_consolidation.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds the Financiero role and consolidated batch status", () => {
    expect(migration).toContain(
      `ALTER TYPE "buildreq_role" ADD VALUE IF NOT EXISTS 'financiero'`
    );
    expect(migration).toContain(
      `ALTER TYPE "treasury_batch_status" ADD VALUE IF NOT EXISTS 'consolidado'`
    );
  });

  it("links source batches to the new consolidated batch", () => {
    expect(migration).toContain('"consolidatedIntoBatchId" integer');
    expect(migration).toContain('"consolidatedById" integer');
    expect(migration).toContain('"consolidatedAt" timestamp');
    expect(migration).toContain("treasury_batch_consolidated_into_fk");
    expect(migration).toContain("treasury_batch_consolidated_into_idx");
  });
});
