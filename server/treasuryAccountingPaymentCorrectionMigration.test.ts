import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("treasury accounting payment correction migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0140_treasury_accounting_payment_corrections.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds the accounting rejection state idempotently", () => {
    expect(migration).toContain(`ALTER TYPE "treasury_batch_status"`);
    expect(migration).toContain(
      "ADD VALUE IF NOT EXISTS 'rechazado_contabilidad'"
    );
  });
});
