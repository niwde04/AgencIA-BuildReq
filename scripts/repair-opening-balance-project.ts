import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Client } from "pg";
import {
  OPENING_PROJECT_REPAIR,
  repairOpeningBalanceProject,
  requireOpeningRepairCloudTarget,
  type OpeningProjectRepairSnapshot,
  type OpeningProjectRepairResult,
} from "../server/openingBalanceProjectRepair";

const projectRef = "ovaergjxbzrirmdwnwot";
const appOrigin = "https://buildreq.aibdev.com";
interface Artifact {
  name: string;
  sha256: string;
  bytes: number;
}
function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Falta valor para ${name}.`);
  return value;
}
function requireCloudTarget() {
  return requireOpeningRepairCloudTarget(
    process.env.DATABASE_URL,
    process.env.SUPABASE_URL
  );
}
async function requireCompatibleDeployment() {
  const healthUrl = new URL(option("--health-url") ?? `${appOrigin}/health`);
  if (
    healthUrl.origin !== appOrigin ||
    healthUrl.pathname !== "/health" ||
    healthUrl.search ||
    healthUrl.hash ||
    healthUrl.username ||
    healthUrl.password
  )
    throw new Error("URL de verificación de aplicación inesperada.");
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  const health = await response.json();
  if (
    !response.ok ||
    health.ok !== true ||
    health.service !== "buildreq" ||
    health.capabilities?.explicitOpeningBalanceProject !== 1
  )
    throw new Error(
      "La aplicación publicada todavía no confirma la selección explícita del proyecto de apertura."
    );
}
async function outputDirectory() {
  const requested = option("--backup-dir");
  if (!requested || !isAbsolute(requested))
    throw new Error(
      "Indique --backup-dir absoluto y existente para conservar el respaldo y la auditoría."
    );
  const root = await realpath(requested);
  if (!(await lstat(root)).isDirectory())
    throw new Error("El respaldo debe guardarse en una carpeta.");
  const name = `opening-project-${new Date().toISOString().replace(/[^0-9TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
  const output = resolve(root, name);
  const path = relative(root, output);
  if (
    !path ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path) ||
    path.includes(sep)
  )
    throw new Error("La carpeta de salida debe ser hija directa del respaldo.");
  await mkdir(output, { recursive: false, mode: 0o700 });
  if (
    (await lstat(output)).isSymbolicLink() ||
    (await realpath(output)) !== output
  )
    throw new Error(
      "La carpeta de auditoría resolvió fuera del destino esperado."
    );
  return output;
}
async function durableWrite(
  directory: string,
  name: string,
  value: unknown
): Promise<Artifact> {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  const file = join(directory, name);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const bytes = Buffer.byteLength(contents, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const persisted = await readFile(file);
  if (
    persisted.length !== bytes ||
    createHash("sha256").update(persisted).digest("hex") !== sha256
  )
    throw new Error("No se pudo verificar la escritura durable del respaldo.");
  // Windows does not support opening directories for fsync; file handles above are synced on every platform.
  if (process.platform !== "win32") {
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }
  return { name, sha256, bytes };
}
async function main() {
  const allowed = new Set(["--apply", "--backup-dir", "--health-url"]);
  const seen = new Set<string>();
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index];
    if (!allowed.has(flag) || seen.has(flag))
      throw new Error("Argumento inesperado o repetido.");
    seen.add(flag);
    if (flag !== "--apply") {
      option(flag);
      index++;
    }
  }
  const apply = seen.has("--apply");
  const connectionString = requireCloudTarget();
  if (apply) await requireCompatibleDeployment();
  const output = await outputDirectory();
  const client = new Client({ connectionString });
  // Never print driver errors, SQL, parameters, connection strings, or record contents.
  client.on("error", () => {
    process.exitCode = 1;
  });
  const artifacts: Artifact[] = [];
  const envelope = {
    projectRef,
    operationKey: OPENING_PROJECT_REPAIR.operationKey,
  };
  let committed = false;
  let transactionCompleted = false;
  try {
    await client.connect();
    const session = await client.query<{ database: string; username: string }>(
      "SELECT current_database() AS database, current_user AS username"
    );
    if (
      session.rows[0]?.database !== "postgres" ||
      session.rows[0]?.username !== "postgres"
    )
      throw new Error(
        "La sesión no corresponde al usuario y base autorizados."
      );
    const saveBefore = async (before: OpeningProjectRepairSnapshot) => {
      artifacts.push(
        await durableWrite(output, "locked-before.json", {
          format: "buildreq-opening-project-before-v1",
          ...envelope,
          capturedAt: new Date().toISOString(),
          before,
        })
      );
      artifacts.push(
        await durableWrite(output, "backup-manifest.json", {
          format: "buildreq-opening-project-backup-v1",
          ...envelope,
          artifacts: [...artifacts],
          restore:
            "Restore only openingBalances id 4 projectId and updatedAt from locked-before.json, in a guarded transaction, only if its current header still matches the prepared after-image. Preserve the issued folio, all lines, warehouse inventory, notes, dates and any subsequent client entries. Never restore entire tables for this header-only repair. Append an external rollback audit.",
        })
      );
    };
    const savePrepared = async (result: OpeningProjectRepairResult) => {
      artifacts.push(
        await durableWrite(output, "prepared-result.json", {
          format: "buildreq-opening-project-audit-v1",
          ...envelope,
          status: "prepared-before-commit",
          preparedAt: new Date().toISOString(),
          ...result,
        })
      );
    };
    const result = await repairOpeningBalanceProject(client, {
      apply,
      beforeApply: saveBefore,
      beforeCommit: savePrepared,
    });
    transactionCompleted = true;
    committed = apply;
    if (!apply) {
      await saveBefore(result.before);
      await savePrepared(result);
    }
    await durableWrite(output, "result.json", {
      format: "buildreq-opening-project-result-v1",
      ...envelope,
      status: apply ? "committed" : "dry-run",
      completedAt: new Date().toISOString(),
      apply,
      changed: result.changed,
      alreadyApplied: result.alreadyApplied,
      header: {
        id: OPENING_PROJECT_REPAIR.openingBalanceId,
        balanceNumber: OPENING_PROJECT_REPAIR.balanceNumber,
        beforeProjectId: result.before.header.projectId,
        afterProjectId: result.after.header.projectId,
        proposedProjectId: OPENING_PROJECT_REPAIR.projectId,
      },
      itemCount: result.after.items.length,
      inventoryCount: result.after.inventory.length,
      fingerprints: result.fingerprints,
      artifacts,
    });
    console.log(
      JSON.stringify(
        {
          ...envelope,
          apply,
          changed: result.changed,
          alreadyApplied: result.alreadyApplied,
          projectId: result.after.header.projectId,
          proposedProjectId: OPENING_PROJECT_REPAIR.projectId,
          balanceNumber: OPENING_PROJECT_REPAIR.balanceNumber,
          itemCount: result.after.items.length,
          inventoryCount: result.after.inventory.length,
          output,
          artifacts,
        },
        null,
        2
      )
    );
  } catch (error) {
    await durableWrite(output, "failure.json", {
      ...envelope,
      apply,
      committed,
      status: transactionCompleted
        ? "transaction-completed-output-failure"
        : "failed-or-commit-unknown",
      artifacts,
      recordedAt: new Date().toISOString(),
      recovery:
        "Inspect the persisted before/prepared snapshots and reread the current header before retrying. No automatic rollback or replay.",
    }).catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
main().catch(() => {
  console.error(
    "La operación no terminó correctamente. Revise el manifiesto de auditoría; no se muestran conexiones ni datos en consola."
  );
  process.exitCode = 1;
});
