/** Creates and removes only a randomly named database on a local PostgreSQL instance. */
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as schema from "../drizzle/schema";
import * as notesSchema from "../drizzle/financial-notes-schema";
import * as retentionSchema from "../drizzle/retention-documents-schema";

const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url
)("drizzle-kit/api") as typeof import("drizzle-kit/api");

async function main() {
  const source = process.env.BILLING_TEST_ADMIN_URL;
  if (!source)
    throw new Error("Falta BILLING_TEST_ADMIN_URL de PostgreSQL local");
  const target = new URL(source);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("Las pruebas requieren un servidor PostgreSQL local");
  }
  const token = randomBytes(8).toString("hex");
  const name = `buildreq_billing_test_${token}`;
  const admin = new Client({ connectionString: source });
  let created = false;
  let fixture: Client | undefined;
  try {
    await admin.connect();
    for (const role of ["anon", "authenticated"]) {
      const found = await admin.query(
        "select 1 from pg_roles where rolname=$1",
        [role]
      );
      if (!found.rowCount) await admin.query(`CREATE ROLE ${role} NOLOGIN`);
    }
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    target.pathname = `/${name}`;
    fixture = new Client({ connectionString: target.toString() });
    await fixture.connect();
    await fixture.query("CREATE SCHEMA IF NOT EXISTS private");
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson({ ...schema, ...notesSchema, ...retentionSchema })
    );
    for (const statement of statements) await fixture.query(statement);
    const migration = readFileSync(
      new URL(
        "../drizzle/20261102120000_purchase_order_billing_authorizations.sql",
        import.meta.url
      ),
      "utf8"
    );
    await fixture.query(migration);
    await fixture.query(migration);
    await fixture.end();
    fixture = undefined;
    console.log("Base temporal local preparada; migración aplicada dos veces.");
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/purchaseOrderBilling.integration.test.ts",
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: target.toString(),
          PURCHASE_ORDER_BILLING_TEST_DATABASE_URL: target.toString(),
          PURCHASE_ORDER_BILLING_TEST_TOKEN: token,
        },
        stdio: "inherit",
      }
    );
    process.exitCode = result.status ?? 1;
  } finally {
    await fixture?.end();
    if (created && /^buildreq_billing_test_[0-9a-f]{16}$/.test(name)) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log("Base temporal de autorizaciones eliminada.");
    }
    await admin.end();
  }
}

main().catch(error => {
  console.error("Fallaron las pruebas locales de autorizaciones", {
    message: error.message,
    code: error.code,
  });
  process.exitCode = 1;
});
