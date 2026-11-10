/** Creates and removes only its own random database on a loopback PostgreSQL server. */
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
async function main() {
  const source = process.env.INVENTORY_UNIT_TEST_ADMIN_URL;
  if (!source) throw new Error("Falta INVENTORY_UNIT_TEST_ADMIN_URL local");
  const target = new URL(source);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.search ||
    target.hash
  )
    throw new Error(
      "Las pruebas requieren un servidor local sin parámetros que cambien el destino"
    );
  const token = randomBytes(8).toString("hex");
  const name = `buildreq_inventory_units_test_${token}`;
  const admin = new Client({ connectionString: source });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    target.pathname = `/${name}`;
    const run = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/inventoryUnitRegularization.test.ts",
        "server/inventoryUnitRegularization.integration.test.ts",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: "",
          INVENTORY_UNIT_TEST_DATABASE_URL: target.toString(),
          INVENTORY_UNIT_TEST_TOKEN: token,
          TZ: "America/Tegucigalpa",
        },
        stdio: "inherit",
        windowsHide: true,
      }
    );
    process.exitCode = run.status ?? 1;
  } finally {
    if (created && /^buildreq_inventory_units_test_[0-9a-f]{16}$/.test(name)) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log("Base desechable de unidades eliminada.");
    }
    await admin.end();
  }
}
main().catch(() => {
  console.error("Fallaron las pruebas aisladas de regularización de unidad.");
  process.exitCode = 1;
});
