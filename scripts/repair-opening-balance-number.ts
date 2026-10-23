import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Client } from "pg";
import { requireOpeningRepairCloudTarget } from "../server/openingBalanceProjectRepair";
import {
  OPENING_NUMBER_REPAIR,
  repairOpeningBalanceNumber,
} from "../server/openingBalanceNumberRepair";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const index = args.indexOf("--backup-dir");
  const requested = args[index + 1];
  if (
    index < 0 ||
    !requested ||
    !isAbsolute(requested) ||
    args.length !== (apply ? 3 : 2) ||
    args.filter(a => a === "--apply").length > 1
  )
    throw new Error(
      "Use --backup-dir RUTA_ABSOLUTA_EXISTENTE y, opcionalmente, --apply."
    );
  const root = await realpath(requested);
  if (!(await lstat(root)).isDirectory())
    throw new Error("El respaldo debe ser una carpeta.");
  const manifest = JSON.parse(
    await readFile(join(root, "backup-manifest.json"), "utf8")
  );
  if (
    manifest.restoreVerified !== true ||
    manifest.projectRef !== "ovaergjxbzrirmdwnwot"
  )
    throw new Error(
      "Falta la verificación de restauración del respaldo Cloud."
    );
  const archive = await readFile(join(root, "application-before.dump"));
  if (createHash("sha256").update(archive).digest("hex") !== manifest.sha256)
    throw new Error("El respaldo no coincide con su manifiesto.");
  const connection = new URL(
    requireOpeningRepairCloudTarget(
      process.env.DATABASE_URL,
      process.env.SUPABASE_URL
    )
  );
  connection.searchParams.set("sslmode", "verify-full");
  if (apply) {
    const response = await fetch("https://buildreq.aibdev.com/health", {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      redirect: "error",
    });
    const health = await response.json();
    if (
      !response.ok ||
      health.service !== "buildreq" ||
      health.capabilities?.openingBalanceRetiredNumberGuard !== 1
    )
      throw new Error(
        "La aplicación publicada aún no confirma la protección de folios retirados."
      );
  }
  const directory = join(
    root,
    `audit-${Date.now()}-${randomUUID().slice(0, 8)}`
  );
  await mkdir(directory, { recursive: false, mode: 0o700 });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error("La carpeta de auditoría resuelve fuera del respaldo.");
  async function durable(name: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value, null, 2));
    const file = join(directory, name);
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!(await readFile(file)).equals(bytes))
      throw new Error("No se pudo verificar la auditoría persistida.");
    return createHash("sha256").update(bytes).digest("hex");
  }
  const client = new Client({
    connectionString: connection.toString(),
    connectionTimeoutMillis: 15000,
  });
  let committed = false;
  try {
    await client.connect();
    const session = await client.query(
      "SELECT current_database() database,current_user username"
    );
    if (
      session.rows[0]?.database !== "postgres" ||
      session.rows[0]?.username !== "postgres"
    )
      throw new Error(
        "La sesión no coincide con la base y el usuario autorizados."
      );
    const hashes: Record<string, string> = {};
    const result = await repairOpeningBalanceNumber(client, {
      apply,
      beforeApply: async before => {
        hashes.before = await durable("locked-before.json", {
          operation: OPENING_NUMBER_REPAIR,
          before,
        });
      },
      beforeCommit: async result => {
        hashes.prepared = await durable("prepared-result.json", {
          status: "prepared-before-commit",
          result,
        });
      },
    });
    committed = apply;
    if (!apply) hashes.dryRun = await durable("dry-run.json", result);
    const summary = {
      status: apply ? "committed" : "dry-run",
      completedAt: new Date().toISOString(),
      operation: OPENING_NUMBER_REPAIR,
      changed: result.changed,
      alreadyApplied: result.alreadyApplied,
      items: result.after.items.length,
      inventoryRows: result.after.inventory.length,
      fingerprints: result.fingerprints,
      hashes,
    };
    await durable("result.json", summary);
    console.log(JSON.stringify({ ...summary, auditDirectory: directory }));
  } catch (error) {
    await durable("failure.json", {
      committed,
      at: new Date().toISOString(),
      code: (error as { code?: string }).code ?? "FAILED",
    }).catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
main().catch(error => {
  // Driver diagnostics can contain private records and connection details.
  console.error({
    result: "La renumeración no se completó; revise la auditoría protegida.",
    code: error.code ?? "FAILED",
  });
  process.exitCode = 1;
});
