/** Runs only against a new disposable database on a loopback PostgreSQL server. */
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as schema from "../drizzle/schema";
import * as notes from "../drizzle/financial-notes-schema";
import * as retentions from "../drizzle/retention-documents-schema";
import * as costs from "../drizzle/cost-matrix-schema";
import * as billing from "../drizzle/purchase-order-billing-schema";

const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url
)("drizzle-kit/api") as typeof import("drizzle-kit/api");
async function main() {
  const source = process.env.INVENTORY_PENDING_TEST_ADMIN_URL;
  if (!source) throw new Error("Falta INVENTORY_PENDING_TEST_ADMIN_URL local");
  const target = new URL(source);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
    throw new Error("Las pruebas requieren PostgreSQL local desechable");
  const token = randomBytes(8).toString("hex");
  const name = `buildreq_inventory_pending_test_${token}`;
  const admin = new Client({ connectionString: source });
  let fixture: Client | undefined,
    created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    target.pathname = `/${name}`;
    fixture = new Client({ connectionString: target.toString() });
    await fixture.connect();
    await fixture.query("CREATE SCHEMA IF NOT EXISTS private");
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson({
        ...schema,
        ...notes,
        ...retentions,
        ...costs,
        ...billing,
      })
    );
    for (const statement of statements) await fixture.query(statement);
    await fixture.end();
    fixture = undefined;
    console.log("Base temporal local de pendientes preparada.");
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/inventoryPendingScopes.test.ts",
        "server/inventoryPendingScopes.integration.test.ts",
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: target.toString(),
          INVENTORY_PENDING_TEST_DATABASE_URL: target.toString(),
          INVENTORY_PENDING_TEST_TOKEN: token,
          TZ: "America/Tegucigalpa",
        },
        stdio: "inherit",
        windowsHide: true,
      }
    );
    process.exitCode = result.status ?? 1;
  } finally {
    await fixture?.end();
    if (
      created &&
      /^buildreq_inventory_pending_test_[0-9a-f]{16}$/.test(name)
    ) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log("Base temporal de pendientes eliminada.");
    }
    await admin.end();
  }
}
main().catch(error => {
  console.error("Fallaron las pruebas locales de pendientes", {
    message: error.message,
    code: error.code,
  });
  process.exitCode = 1;
});
