import "dotenv/config";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { importCostMatrix, validateCostMatrixSeed } from "./cost-matrix-import";

// Never run during application startup. Default execution only inspects the target.
async function main() {
  const args = process.argv.slice(2);
  const allowed = ["--apply", "--expect-host", "--expect-database", "--assets"];
  for (let i = 0; i < args.length; i++) {
    if (!allowed.includes(args[i])) throw new Error("Argumento desconocido");
    if (args[i] !== "--apply") i++;
  }
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const target = new URL(connectionString);
  if (
    !option("--expect-host") ||
    target.hostname !== option("--expect-host") ||
    decodeURIComponent(target.pathname.slice(1)) !== option("--expect-database")
  )
    throw new Error(
      "Debe confirmar --expect-host y --expect-database exactamente; no se aplicaron cambios"
    );
  const root = resolve(option("--assets") ?? ".");
  const seedBytes = readFileSync(
    resolve(root, "data/cost-matrix/initial.json")
  );
  const report = JSON.parse(
    readFileSync(resolve(root, "data/cost-matrix/source-report.json"), "utf8")
  );
  if (
    createHash("sha256").update(seedBytes).digest("hex") !== report.seedSha256
  )
    throw new Error("Huella de la carga inicial incorrecta");
  const seed = validateCostMatrixSeed(JSON.parse(seedBytes.toString()));
  const migration = readFileSync(
    resolve(root, "drizzle/20260930000100_cost_matrix.sql"),
    "utf8"
  );
  const apply = args.includes("--apply");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    const identity = (
      await client.query(
        "SELECT current_database() database, current_user AS role, inet_server_addr()::text address"
      )
    ).rows[0];
    if (identity.database !== option("--expect-database"))
      throw new Error("Base de datos inesperada");
    console.log(
      JSON.stringify({
        target: { host: target.hostname, ...identity },
        sourceSha256: report.sourceSha256,
        mode: apply ? "apply" : "dry-run",
      })
    );
    const exists = (
      await client.query(
        `SELECT to_regclass('public."costMatrixEntries"') IS NOT NULL AS present`
      )
    ).rows[0].present;
    if (!apply && !exists) {
      console.log(
        JSON.stringify({
          migration: "pending",
          incoming: seed.length,
          inserted: seed.length,
          skipped: 0,
        })
      );
      return;
    }
    if (apply) await client.query(migration);
    console.log(JSON.stringify(await importCostMatrix(client, seed, apply)));
    const verification = (
      await client.query(`SELECT "jobCode", count(*)::int AS records, count(DISTINCT "matrixCode")::int AS codes,
      count(*) FILTER (WHERE "matrixCode" <> "jobCode" || '-' || n1 || '-' || n2 || '-' || n3 || '-' || n4)::int AS invalid
      FROM public."costMatrixEntries" GROUP BY "jobCode" ORDER BY "jobCode"`)
    ).rows;
    console.log(JSON.stringify({ verification }));
  } finally {
    await client.end();
  }
}
main().catch(error => {
  console.error("No se completó la carga de matriz de costos.", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
