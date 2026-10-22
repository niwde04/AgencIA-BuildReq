import "dotenv/config";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getDb } from "../server/db";
import { queryRows } from "../server/contractualAdvances";
import {
  ICA_CORRECTION_KEY,
  regularizeIca,
  type IcaSnapshot,
} from "../server/icaAdvanceReconciliation";
import { sql } from "drizzle-orm";

const projectRef = "ovaergjxbzrirmdwnwot";
const appOrigin = "https://buildreq.aibdev.com";
function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Falta valor para ${name}.`);
  return value;
}
function requireCloudTarget() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  const supabaseUrl = new URL(process.env.SUPABASE_URL ?? "");
  const username = decodeURIComponent(databaseUrl.username);
  const direct =
    databaseUrl.hostname === `db.${projectRef}.supabase.co` &&
    username === "postgres";
  const pooler =
    databaseUrl.hostname.endsWith(".pooler.supabase.com") &&
    username === `postgres.${projectRef}`;
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !(direct || pooler) ||
    databaseUrl.pathname !== "/postgres" ||
    supabaseUrl.protocol !== "https:" ||
    supabaseUrl.hostname !== `${projectRef}.supabase.co`
  )
    throw new Error(
      "El destino no coincide con el proyecto Cloud y usuario autorizados; no se ejecutó la regularización."
    );
}
async function requireCompatibleDeployment() {
  const requested = new URL(option("--health-url") ?? `${appOrigin}/health`);
  if (
    requested.origin !== appOrigin ||
    requested.pathname !== "/health" ||
    requested.search ||
    requested.hash ||
    requested.username ||
    requested.password
  )
    throw new Error("URL de verificación de aplicación inesperada.");
  const response = await fetch(requested, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  const health = await response.json();
  if (
    !response.ok ||
    health.ok !== true ||
    health.service !== "buildreq" ||
    health.capabilities?.legacyManualAdvances !== 1 ||
    health.capabilities?.advanceAmortizationGuard !== 1
  )
    throw new Error(
      "La aplicación publicada todavía no confirma la protección y lectura compatible de amortizaciones."
    );
}
function inside(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}
async function outputDirectory() {
  const backupRoot = option("--backup-root");
  const requested = option("--output-dir");
  if (
    !backupRoot ||
    !requested ||
    !isAbsolute(backupRoot) ||
    !isAbsolute(requested)
  )
    throw new Error(
      "Indique --backup-root y --output-dir absolutos, con una carpeta de salida nueva dentro del respaldo."
    );
  const parent = await realpath(backupRoot);
  const output = resolve(requested);
  if (!inside(parent, output))
    throw new Error("La carpeta de salida debe estar dentro de --backup-root.");
  // Require a new direct child. No existing symlinks or parent junctions may redirect the snapshot.
  if (relative(parent, output).includes(sep))
    throw new Error(
      "La carpeta de salida debe ser hija directa de --backup-root."
    );
  await mkdir(output, { recursive: false, mode: 0o700 });
  if (
    (await lstat(output)).isSymbolicLink() ||
    !inside(parent, await realpath(output))
  )
    throw new Error(
      "La carpeta de respaldo resolvió fuera del destino autorizado."
    );
  return output;
}
async function durableWrite(file: string, contents: string) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function main() {
  const allowed = new Set([
    "--apply",
    "--backup-root",
    "--output-dir",
    "--health-url",
  ]);
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index];
    if (!allowed.has(flag)) throw new Error(`Argumento inesperado: ${flag}`);
    if (flag !== "--apply") index++;
  }
  const apply = process.argv.includes("--apply");
  requireCloudTarget();
  if (apply) await requireCompatibleDeployment();
  const output = await outputDirectory();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // Never print connection objects or credentials in this maintenance process.
  (db as any).$client.removeAllListeners("error");
  (db as any).$client.on("error", (error: any) =>
    console.error({ message: error.message, code: error.code })
  );
  let backup: { file: string; sha256: string; bytes: number } | undefined;
  try {
    const [target] = await queryRows<any>(
      db,
      sql`select current_database() as database, current_user as username`
    );
    if (target?.database !== "postgres" || target.username !== "postgres")
      throw new Error(
        "La sesión de base de datos no corresponde al usuario y base autorizados."
      );
    const saveBackup = async (before: IcaSnapshot) => {
      const envelope = {
        format: "buildreq-ica-locked-before-v1",
        projectRef,
        operationKey: ICA_CORRECTION_KEY,
        capturedAt: new Date().toISOString(),
        before,
      };
      const contents = `${JSON.stringify(envelope, null, 2)}\n`;
      const file = join(output, "locked-before.json");
      const sha256 = createHash("sha256")
        .update(contents, "utf8")
        .digest("hex");
      const bytes = Buffer.byteLength(contents, "utf8");
      await durableWrite(file, contents);
      await durableWrite(
        join(output, "locked-before.sha256"),
        `${sha256}  locked-before.json\n`
      );
      await durableWrite(
        join(output, "backup-manifest.json"),
        `${JSON.stringify({ format: envelope.format, projectRef, operationKey: ICA_CORRECTION_KEY, capturedAt: envelope.capturedAt, artifacts: [{ name: "locked-before.json", bytes, sha256 }], restore: "Use the exact before.advances[0] and before.applications[0] values only in a guarded transaction. Restore no entire table; remove only the newly created invoiceContractualAmortizations row if its values still match this operation; preserve the original audit and append a rollback event. Refuse rollback if payments, reservations, applications or other operation rows have changed." }, null, 2)}\n`
      );
      backup = { file, sha256, bytes };
    };
    const result = await db.transaction(tx =>
      regularizeIca(tx, { apply, beforeApply: saveBackup })
    );
    if (!apply || result.alreadyApplied) await saveBackup(result.before);
    await durableWrite(
      join(output, "result.json"),
      `${JSON.stringify({ ...result, projectRef, operationKey: ICA_CORRECTION_KEY, backup }, null, 2)}\n`
    );
    console.log(
      JSON.stringify(
        {
          apply,
          changed: result.changed,
          alreadyApplied: result.alreadyApplied,
          expected: result.expected,
          operationKey: ICA_CORRECTION_KEY,
          backup,
          output,
        },
        null,
        2
      )
    );
  } finally {
    await (db as any).$client.end();
  }
}
main().catch(error => {
  // Drizzle's wrapper includes SQL parameters; report the underlying diagnostic only.
  const failure = error?.cause ?? error;
  console.error({ message: failure.message, code: failure.code });
  process.exitCode = 1;
});
