import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cash purchase order payment method migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0131_cash_purchase_order_payment_method.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds Contado to the existing payment method enum safely", () => {
    expect(migration).toContain('ALTER TYPE "payment_method"');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'contado'");
  });
});
