/** Disposable PostgreSQL database; never executes fixtures against DATABASE_URL. */
import "dotenv/config";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url
)("drizzle-kit/api") as typeof import("drizzle-kit/api");
import * as schema from "../drizzle/schema";

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source)
    throw new Error(
      "DATABASE_URL is required to provision an isolated test database"
    );
  if (
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(source).hostname
    )
  )
    throw new Error(
      "Sales-tax integration tests require a local disposable PostgreSQL server"
    );
  const token = randomBytes(8).toString("hex");
  const name = `buildreq_taxes_test_${token}`;
  const url = new URL(source);
  const admin = new Client({ connectionString: source });
  let created = false;
  let fixture: Client | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    fixture = new Client({ connectionString: url.toString() });
    await fixture.connect();
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema)
    );
    await fixture.query("CREATE SCHEMA IF NOT EXISTS private");
    for (const statement of statements) await fixture.query(statement);
    await fixture.query(
      'ALTER TABLE invoices DROP COLUMN "creditNoteTotal", DROP COLUMN "debitNoteTotal"; ALTER TABLE "reverseLogisticsItems" DROP COLUMN "sourceReceiptItemId"'
    );
    const migration = readFileSync(
      new URL("../drizzle/0142_financial_notes.sql", import.meta.url),
      "utf8"
    );
    await fixture.query(migration);
    await fixture.query(migration); // Verify a second application preserves the catalog/cutoff.
    await fixture.query(
      'ALTER TABLE "salesTaxes" DROP COLUMN "financialGroupCode"'
    );
    const taxMigration = readFileSync(
      new URL(
        "../drizzle/20260929035318_sales_tax_financial_groups.sql",
        import.meta.url
      ),
      "utf8"
    );
    await fixture.query(taxMigration);
    await fixture.query(taxMigration);
    await fixture.end();
    fixture = undefined;
    console.log(
      "Isolated schema ready; migration applied twice. Running sales-tax database tests."
    );
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/salesTaxes.integration.test.ts",
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          SALES_TAXES_TEST_DATABASE_URL: url.toString(),
          SALES_TAXES_TEST_TOKEN: token,
        },
        stdio: "inherit",
      }
    );
    process.exitCode = result.status ?? 1;
  } finally {
    await fixture?.end();
    if (created && /^buildreq_taxes_test_[0-9a-f]{16}$/.test(name)) {
      // This name is created exclusively above; no user-supplied database can be dropped.
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log("Isolated test database removed.");
    }
    await admin.end();
  }
}
main().catch(error => {
  console.error("Isolated database tests failed", {
    message: error.message,
    code: error.code,
  });
  process.exitCode = 1;
});
