import "dotenv/config";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getDb } from "../server/db";
import { queryRows } from "../server/contractualAdvances";
import { sql } from "drizzle-orm";
import {
  INVOICE_SETTLEMENT_ACTIVATION_KEY,
  activateInvoiceSettlementPolicies,
  type InvoiceSettlementActivationPreview,
} from "../server/invoiceSettlement";

const projectRef = "ovaergjxbzrirmdwnwot";
const site = "https://buildreq.aibdev.com";
function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Falta valor para ${name}.`);
  return value;
}
function requireCloudTarget() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  const supabase = new URL(process.env.SUPABASE_URL ?? "");
  const user = decodeURIComponent(database.username);
  const direct =
    database.hostname === `db.${projectRef}.supabase.co` && user === "postgres";
  const pooler =
    database.hostname.endsWith(".pooler.supabase.com") &&
    user === `postgres.${projectRef}`;
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !(direct || pooler) ||
    database.pathname !== "/postgres" ||
    supabase.protocol !== "https:" ||
    supabase.hostname !== `${projectRef}.supabase.co`
  )
    throw new Error("El destino no corresponde a la base Cloud autorizada.");
}
async function compatibleDeployment() {
  const response = await fetch(`${site}/health`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  const health = await response.json();
  if (
    !response.ok ||
    health.ok !== true ||
    health.service !== "buildreq" ||
    health.capabilities?.invoiceSettlementDocumentCents !== 1 ||
    health.capabilities?.advanceAmortizationGuard !== 1
  )
    throw new Error("Servidor publicado sin soporte histórico compatible.");
  const page = await fetch(site, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  const asset = (await page.text()).match(/src="(\/assets\/[^"/]+\.js)"/);
  if (!page.ok || !asset)
    throw new Error("No se pudo verificar el cliente publicado.");
  const client = await fetch(`${site}${asset[1]}`, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!client.ok || !(await client.text()).includes("document_cents_v1"))
    throw new Error("Cliente publicado sin soporte histórico compatible.");
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
async function outputDirectory() {
  const root = option("--backup-root"),
    requested = option("--output-dir");
  if (!root || !requested || !isAbsolute(root) || !isAbsolute(requested))
    throw new Error("Se requieren --backup-root y --output-dir absolutos.");
  const parent = await realpath(root),
    output = resolve(requested),
    child = relative(parent, output);
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    child.includes(sep) ||
    isAbsolute(child)
  )
    throw new Error(
      "La salida debe ser una carpeta hija directa nueva dentro del respaldo."
    );
  await mkdir(output, { recursive: false, mode: 0o700 });
  if (
    (await lstat(output)).isSymbolicLink() ||
    relative(parent, await realpath(output)) !== child
  )
    throw new Error("La salida resolvió fuera del respaldo autorizado.");
  return output;
}
async function main() {
  const allowed = new Set(["--apply", "--backup-root", "--output-dir"]);
  for (let i = 2; i < process.argv.length; i++) {
    if (!allowed.has(process.argv[i]))
      throw new Error(`Argumento inesperado: ${process.argv[i]}`);
    if (process.argv[i] !== "--apply") i++;
  }
  const apply = process.argv.includes("--apply");
  requireCloudTarget();
  if (apply) await compatibleDeployment();
  const output = await outputDirectory();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  (db as any).$client.removeAllListeners("error");
  (db as any).$client.on("error", (e: any) =>
    console.error({ message: e.message, code: e.code })
  );
  let backup: { file: string; sha256: string; bytes: number } | undefined;
  try {
    const [identity] = await queryRows<any>(
      db,
      sql`select current_database() as database,current_user as username`
    );
    if (identity.database !== "postgres" || identity.username !== "postgres")
      throw new Error("Sesión de base inesperada.");
    const saveBackup = async (before: InvoiceSettlementActivationPreview) => {
      const contents = `${JSON.stringify({ format: "buildreq-invoice-settlement-locked-before-v1", projectRef, operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY, capturedAt: new Date().toISOString(), before }, null, 2)}\n`;
      const file = join(output, "locked-before.json"),
        sha256 = createHash("sha256").update(contents).digest("hex");
      await durableWrite(file, contents);
      await durableWrite(
        join(output, "locked-before.sha256"),
        `${sha256}  locked-before.json\n`
      );
      backup = { file, sha256, bytes: Buffer.byteLength(contents) };
      await durableWrite(
        join(output, "backup-manifest.json"),
        `${JSON.stringify({ projectRef, operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY, backup, restore: "Disable only new enrollments while preserving all readers. Do not remove policies after payments, reservations, notes or advance use. Any correction must preserve original invoice amounts and append audit evidence; never restore whole tables." }, null, 2)}\n`
      );
    };
    const result = await db.transaction(
      tx =>
        activateInvoiceSettlementPolicies(tx, {
          apply,
          actorId: 1,
          beforeApply: saveBackup,
        }),
      { isolationLevel: "read committed" }
    );
    if (!apply || result.alreadyApplied) await saveBackup(result.before);
    await durableWrite(
      join(output, "result.json"),
      `${JSON.stringify({ ...result, projectRef, operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY, backup }, null, 2)}\n`
    );
    console.log(
      JSON.stringify(
        {
          apply,
          changed: result.changed,
          alreadyApplied: result.alreadyApplied,
          summary: result.summary,
          operationKey: INVOICE_SETTLEMENT_ACTIVATION_KEY,
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
  const cause = error?.cause ?? error;
  console.error({ message: cause.message, code: cause.code });
  process.exitCode = 1;
});
