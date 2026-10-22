/** Provisions only the fixed localhost opening-balance test database, never an existing database. */
import "dotenv/config";
import { Client } from "pg";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import * as schema from "../drizzle/schema";

const require = createRequire(import.meta.url);
const { generateDrizzleJson, generateMigration } =
  require("drizzle-kit/api") as typeof import("drizzle-kit/api");
const databaseName = "buildreq_opening_balances_test";

async function main() {
  const source = process.env.OPENING_BALANCES_LOCAL_DATABASE_URL;
  if (!source)
    throw new Error(
      "OPENING_BALANCES_LOCAL_DATABASE_URL must name a disposable localhost PostgreSQL instance"
    );
  const url = new URL(source);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Opening-balance tests refuse remote databases");
  if (url.pathname !== "/postgres")
    throw new Error("The local admin source must use the postgres database");
  // pg gives host/user/port query parameters priority over the URL authority.
  // Whitelist harmless connection options before any connection or CREATE.
  for (const key of Array.from(url.searchParams.keys())) {
    if (!["sslmode", "application_name"].includes(key))
      throw new Error(
        "Opening-balance tests refuse target-overriding connection parameters"
      );
  }
  const admin = new Client({ connectionString: source });
  let created = false;
  let fixture: Client | undefined;
  try {
    await admin.connect();
    // CREATE refuses an existing database. Cleanup is permitted only after our own successful CREATE.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    fixture = new Client({ connectionString: url.toString() });
    await fixture.connect();
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema)
    );
    await fixture.query("CREATE SCHEMA IF NOT EXISTS private");
    for (const statement of statements) await fixture.query(statement);
    await fixture.end();
    fixture = undefined;
    const test = spawnSync(
      process.execPath,
      [
        require.resolve("vitest/vitest.mjs"),
        "run",
        "server/openingBalances.integration.test.ts",
        "--fileParallelism=false",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          OPENING_BALANCES_TEST_DATABASE_URL: url.toString(),
        },
        stdio: "inherit",
        windowsHide: true,
      }
    );
    if (test.error) throw test.error;
    process.exitCode = test.status ?? 1;
  } finally {
    await fixture?.end();
    if (created)
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
    if (created) console.log("Disposable opening-balance database removed.");
  }
}
main().catch(error => {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
});
