/** Creates a disposable local PostgreSQL database; production URLs are refused. */
import "dotenv/config";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as schema from "../drizzle/schema";

const require = createRequire(import.meta.url);
const { generateDrizzleJson, generateMigration } =
  require("drizzle-kit/api") as typeof import("drizzle-kit/api");

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source)
    throw new Error(
      "DATABASE_URL must identify the local test PostgreSQL instance"
    );
  const url = new URL(source);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error(
      "Settlement database tests require local disposable PostgreSQL"
    );
  const token = randomBytes(8).toString("hex");
  const name = `buildreq_settlement_test_${token}`;
  const admin = new Client({ connectionString: source });
  let created = false;
  let fixture: Client | undefined;
  try {
    await admin.connect();
    await admin.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$`
    );
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    fixture = new Client({ connectionString: url.toString() });
    await fixture.connect();
    await fixture.query("CREATE SCHEMA IF NOT EXISTS private");
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema)
    );
    for (const statement of statements)
      await fixture.query(
        statement.replace(/'pendiente_contabilizar',\s*/g, "")
      );
    await fixture.query(
      'ALTER TABLE invoices DROP COLUMN "creditNoteTotal", DROP COLUMN "debitNoteTotal"; ALTER TABLE "reverseLogisticsItems" DROP COLUMN "sourceReceiptItemId"'
    );
    const apply = async (filename: string) => {
      const content = readFileSync(
        new URL(`../drizzle/${filename}`, import.meta.url),
        "utf8"
      );
      await fixture!.query(content);
      await fixture!.query(content);
    };
    await apply("0142_financial_notes.sql");
    await fixture.query(
      'ALTER TABLE invoices DROP COLUMN "submittedForAccountingAt", DROP COLUMN "submittedForAccountingById"'
    );
    await apply("20260929052542_invoice_accounting_queue.sql");
    await apply("20260930_contractual_advances.sql");
    await apply("20261005223104_legacy_manual_advances.sql");
    // These tests cover settlement, not immutable fiscal-document closure migration.
    await fixture.query(
      readFileSync(
        new URL(
          "../drizzle/20260930120000_retention_documents.sql",
          import.meta.url
        ),
        "utf8"
      ).split("CREATE OR REPLACE FUNCTION private.retention_immutable")[0]
    );
    const settlementMigrations = readdirSync(
      new URL("../supabase/migrations/", import.meta.url)
    ).filter(name => /invoice_settlement.*\.sql$/.test(name));
    if (settlementMigrations.length !== 1)
      throw new Error("Exactly one invoice-settlement migration is required");
    const settlementSql = readFileSync(
      new URL(
        `../supabase/migrations/${settlementMigrations[0]}`,
        import.meta.url
      ),
      "utf8"
    );
    await fixture.query(settlementSql);
    await fixture.query(settlementSql);
    await fixture.end();
    fixture = undefined;
    console.log(
      "Isolated settlement schema ready; additive migrations applied twice."
    );
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("vitest/vitest.mjs"),
        "run",
        "server/invoiceSettlement.integration.test.ts",
        "--fileParallelism=false",
        "--cache=false",
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          INVOICE_SETTLEMENT_TEST_DATABASE_URL: url.toString(),
          INVOICE_SETTLEMENT_TEST_TOKEN: token,
          INVOICE_SETTLEMENT_TEST_MIGRATION: settlementMigrations[0],
        },
        stdio: "inherit",
        windowsHide: true,
      }
    );
    process.exitCode = result.status ?? 1;
  } finally {
    await fixture?.end();
    if (created && /^buildreq_settlement_test_[0-9a-f]{16}$/.test(name)) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log("Isolated settlement database removed.");
    }
    await admin.end();
  }
}
main().catch(error => {
  console.error("Settlement database tests failed", {
    message: error.message,
    code: error.code,
  });
  process.exitCode = 1;
});
