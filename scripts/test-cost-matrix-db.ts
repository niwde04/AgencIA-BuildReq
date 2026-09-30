import "dotenv/config";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
async function main() {
  const source = process.env.COST_MATRIX_LOCAL_DATABASE_URL;
  if (
    !source ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(source).hostname)
  )
    throw new Error(
      "Defina COST_MATRIX_LOCAL_DATABASE_URL apuntando a PostgreSQL local descartable"
    );
  const name = `buildreq_matrix_test_${randomBytes(8).toString("hex")}`;
  const url = new URL(source);
  url.pathname = "/" + name;
  const admin = new Client({ connectionString: source });
  let created = false;
  const createdRoles: string[] = [];
  try {
    await admin.connect();
    for (const role of ["anon", "authenticated"]) {
      if (
        !(
          await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])
        ).rowCount
      ) {
        await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
        createdRoles.push(role);
      }
    }
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const db = new Client({ connectionString: url.toString() });
    await db.connect();
    try {
      await db.query(
        "CREATE TABLE public.users (id serial PRIMARY KEY); INSERT INTO users VALUES (1), (2)"
      );
      await db.query(
        "CREATE TABLE public.operational_sentinel (id int PRIMARY KEY, amount numeric); INSERT INTO operational_sentinel VALUES (1, 123.45)"
      );
      const migration = readFileSync(
        "drizzle/20260930000100_cost_matrix.sql",
        "utf8"
      );
      await db.query(migration);
      await db.query(migration);
    } finally {
      await db.end();
    }
    const test = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/costMatrix.test.ts",
        "server/costMatrix.integration.test.ts",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          COST_MATRIX_TEST_DATABASE_URL: url.toString(),
        },
        stdio: "inherit",
        windowsHide: true,
      }
    );
    process.exitCode = test.status ?? 1;
  } finally {
    if (created && /^buildreq_matrix_test_[a-f0-9]{16}$/.test(name))
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    for (const role of createdRoles) await admin.query(`DROP ROLE "${role}"`);
    await admin.end();
    console.log("Base temporal de matriz eliminada.");
  }
}
main().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
