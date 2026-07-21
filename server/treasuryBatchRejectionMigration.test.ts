import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("treasury batch rejection migration", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/0118_treasury_batch_rejection.sql",
      import.meta.url
    ),
    "utf8"
  );

  it("adds the rejected treasury batch status idempotently", () => {
    expect(migration).toContain('ALTER TYPE "treasury_batch_status"');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'rechazado'");
  });
});
