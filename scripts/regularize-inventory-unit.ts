import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import {
  INVENTORY_UNIT_REGULARIZATION,
  InventoryUnitRegularizationError,
  InventoryUnitCommitOutcomeUnknownError,
  applyInventoryUnitRegularization,
  inspectInventoryUnitRegularization,
  inventoryUnitScope,
  requireInventoryUnitCloudTarget,
  restoreInventoryUnitRegularization,
  type InventoryUnitPlan,
  type InventoryUnitResult,
  type InventoryUnitScope,
  type InventoryUnitSnapshot,
} from "../server/inventoryUnitRegularization";

interface CliOptions {
  mode: "dry-run" | "apply" | "restore";
  scope: InventoryUnitScope;
  backupDir: string;
  manifest?: string;
  manifestSha256?: string;
  confirmation?: string;
  confirmPhysical: boolean;
  confirmReaders: boolean;
  readerEvidence: string;
  actor: string;
  reason: string;
}
export function parseInventoryUnitArgs(args: string[]): CliOptions {
  const flags = new Set([
    "--dry-run",
    "--apply",
    "--restore",
    "--confirm-one-und-is-one-gal",
    "--confirm-compatible-readers",
  ]);
  const values = new Set([
    "--scope",
    "--backup-dir",
    "--manifest",
    "--manifest-sha256",
    "--confirm",
    "--reader-evidence",
    "--actor",
    "--reason",
  ]);
  const input = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--") continue;
    if ((!flags.has(flag) && !values.has(flag)) || input.has(flag))
      throw new InventoryUnitRegularizationError(
        "argumento inesperado o repetido."
      );
    if (flags.has(flag)) {
      input.set(flag, "true");
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new InventoryUnitRegularizationError(`falta valor para ${flag}.`);
    input.set(flag, value);
  }
  const modes = ["--dry-run", "--apply", "--restore"].filter(flag =>
    input.has(flag)
  );
  if (modes.length > 1)
    throw new InventoryUnitRegularizationError(
      "indique un solo modo de operación."
    );
  const mode =
    modes[0] === "--apply"
      ? "apply"
      : modes[0] === "--restore"
        ? "restore"
        : "dry-run";
  const scope = input.get("--scope") ?? "aliases";
  if (scope !== "aliases" && scope !== "all")
    throw new InventoryUnitRegularizationError(
      "el alcance debe ser aliases o all."
    );
  const backupDir = input.get("--backup-dir");
  if (!backupDir || !isAbsolute(backupDir))
    throw new InventoryUnitRegularizationError(
      "indique --backup-dir absoluto y existente."
    );
  if (
    mode !== "dry-run" &&
    (!input.get("--manifest") ||
      !/^[0-9a-f]{64}$/.test(input.get("--manifest-sha256") ?? "") ||
      !input.get("--confirm") ||
      !input.get("--actor") ||
      !input.get("--reason"))
  )
    throw new InventoryUnitRegularizationError(
      "aplicar o restaurar requiere manifiesto, SHA256, confirmación, responsable y motivo."
    );
  if (
    mode === "apply" &&
    (!input.has("--confirm-compatible-readers") ||
      !input.get("--reader-evidence"))
  )
    throw new InventoryUnitRegularizationError(
      "verifique primero la publicación de lectores compatibles y registre --confirm-compatible-readers y --reader-evidence."
    );
  if (
    mode === "apply" &&
    scope === "all" &&
    !input.has("--confirm-one-und-is-one-gal")
  )
    throw new InventoryUnitRegularizationError(
      "el alcance all requiere confirmación física explícita de 1 und = 1 galón."
    );
  return {
    mode,
    scope,
    backupDir,
    manifest: input.get("--manifest"),
    manifestSha256: input.get("--manifest-sha256"),
    confirmation: input.get("--confirm"),
    confirmPhysical: input.has("--confirm-one-und-is-one-gal"),
    confirmReaders: input.has("--confirm-compatible-readers"),
    readerEvidence: input.get("--reader-evidence") ?? "",
    actor: input.get("--actor") ?? "",
    reason: input.get("--reason") ?? "",
  };
}
interface Artifact {
  name: string;
  bytes: number;
  sha256: string;
}
export function inventoryUnitSafeDiagnostic(error: unknown) {
  const value = error as { name?: unknown; code?: unknown };
  return {
    message:
      error instanceof InventoryUnitRegularizationError
        ? error.message
        : "No se pudo completar la regularización; revise la evidencia de la operación. No se imprimieron credenciales ni detalles del controlador.",
    name:
      typeof value?.name === "string" &&
      /^[A-Za-z][A-Za-z0-9]{0,70}$/.test(value.name)
        ? value.name
        : "Error",
    code:
      typeof value?.code === "string" && /^[A-Z0-9_]{2,64}$/.test(value.code)
        ? value.code
        : undefined,
  };
}
export async function durableInventoryUnitWrite(
  directory: string,
  name: string,
  value: unknown
): Promise<Artifact> {
  if (!/^[a-z0-9-]+\.json$/.test(name))
    throw new InventoryUnitRegularizationError(
      "nombre de artefacto inesperado."
    );
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const target = join(directory, name);
  const file = await open(target, "wx", 0o600);
  try {
    await file.writeFile(data, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  const bytes = Buffer.byteLength(data);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const persisted = await readFile(target);
  if (
    persisted.length !== bytes ||
    createHash("sha256").update(persisted).digest("hex") !== sha256
  )
    throw new InventoryUnitRegularizationError(
      "no se pudo verificar el respaldo durable."
    );
  if (process.platform !== "win32") {
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  return { name, bytes, sha256 };
}
async function outputDirectory(root: string) {
  const parent = await realpath(root);
  if (!(await lstat(parent)).isDirectory())
    throw new InventoryUnitRegularizationError(
      "el destino de respaldo no es una carpeta."
    );
  const output = resolve(
    parent,
    `inventory-unit-${new Date().toISOString().replace(/[^0-9TZ]/g, "")}-${randomUUID().slice(0, 8)}`
  );
  const local = relative(parent, output);
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    local.includes(sep) ||
    isAbsolute(local)
  )
    throw new InventoryUnitRegularizationError(
      "destino de respaldo inesperado."
    );
  await mkdir(output, { recursive: false, mode: 0o700 });
  if (
    (await lstat(output)).isSymbolicLink() ||
    (await realpath(output)) !== output
  )
    throw new InventoryUnitRegularizationError(
      "la carpeta resolvió fuera del respaldo."
    );
  return output;
}
async function readApprovedManifest(options: CliOptions) {
  const bytes = await readFile(resolve(options.manifest!));
  if (
    createHash("sha256").update(bytes).digest("hex") !== options.manifestSha256
  )
    throw new InventoryUnitRegularizationError(
      "el archivo no coincide con el SHA256 revisado."
    );
  return JSON.parse(bytes.toString("utf8"));
}

async function main() {
  const options = parseInventoryUnitArgs(process.argv.slice(2));
  // Only CLI execution loads the environment. Importing parsers/tests cannot load production credentials.
  await import("dotenv/config");
  const connectionString = requireInventoryUnitCloudTarget(
    process.env.DATABASE_URL,
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  );
  const input =
    options.mode === "dry-run"
      ? undefined
      : await readApprovedManifest(options);
  if (
    options.mode === "apply" &&
    (input?.format !== "buildreq-inventory-unit-plan-v2" ||
      input.scope !== options.scope)
  )
    throw new InventoryUnitRegularizationError(
      "el plan revisado no coincide con el alcance solicitado."
    );
  if (
    options.mode === "restore" &&
    (input?.format !== "buildreq-inventory-unit-result-v2" ||
      input.status !== "committed" ||
      input.result?.mode !== "apply" ||
      input.result.scope !== options.scope)
  )
    throw new InventoryUnitRegularizationError(
      "se requiere el recibo confirmado de la aplicación original y su alcance."
    );
  const output = await outputDirectory(options.backupDir);
  const artifacts: Artifact[] = [];
  const envelope = {
    projectRef: INVENTORY_UNIT_REGULARIZATION.projectRef,
    operationKey: inventoryUnitScope(options.scope).operationKey,
    scope: options.scope,
  };
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    application_name: "buildreq-inventory-unit-regularization",
    options:
      options.mode === "dry-run"
        ? "-c default_transaction_read_only=on -c statement_timeout=15000"
        : "-c statement_timeout=15000 -c lock_timeout=5000",
  });
  let committed = false;
  let stage = "connect";
  try {
    await client.connect();
    stage = "session-identity";
    const session = (
      await client.query(
        "SELECT current_database() AS database,current_user AS username"
      )
    ).rows[0];
    if (session.database !== "postgres" || session.username !== "postgres")
      throw new InventoryUnitRegularizationError(
        "la sesión no corresponde a la base y usuario autorizados."
      );
    const saveBefore = async (before: InventoryUnitSnapshot) => {
      stage = "backup-before";
      artifacts.push(
        await durableInventoryUnitWrite(output, "locked-before.json", {
          format: "buildreq-inventory-unit-backup-v2",
          ...envelope,
          capturedAt: new Date().toISOString(),
          before,
        })
      );
      artifacts.push(
        await durableInventoryUnitWrite(output, "backup-manifest.json", {
          format: "buildreq-inventory-unit-backup-manifest-v2",
          ...envelope,
          artifacts: [...artifacts],
          operator: {
            actor: options.actor.trim(),
            reason: options.reason.trim(),
          },
          physicalEquivalenceConfirmed:
            options.scope === "all" && options.confirmPhysical,
          compatibleReadersConfirmed: options.confirmReaders,
          readerEvidence: options.readerEvidence.trim(),
          restore:
            "Use only the committed operation receipt with --restore and its SHA256. Restoration requires exact after-images, never restores whole tables, and changes only unit/updatedAt of the recorded target rows. Any later change stops automatic restore. Historical documents and quantities remain unchanged.",
          pendingPhysicalConfirmation:
            options.scope === "all" && !options.confirmPhysical,
        })
      );
    };
    const savePrepared = async (result: InventoryUnitResult) => {
      stage = "audit-precommit";
      artifacts.push(
        await durableInventoryUnitWrite(output, "prepared-result.json", {
          format: "buildreq-inventory-unit-result-v2",
          ...envelope,
          status: "prepared-before-commit",
          preparedAt: new Date().toISOString(),
          result,
        })
      );
    };
    if (options.mode === "dry-run") {
      stage = "read-only-snapshot";
      const plan = await inspectInventoryUnitRegularization(
        client,
        options.scope
      );
      await saveBefore(plan.before);
      const planFile = await durableInventoryUnitWrite(
        output,
        "plan.json",
        plan
      );
      artifacts.push(planFile);
      await durableInventoryUnitWrite(output, "result.json", {
        format: "buildreq-inventory-unit-dry-run-v2",
        ...envelope,
        status: "dry-run",
        generatedAt: new Date().toISOString(),
        classification: plan.classification,
        targetIds: plan.targetIds,
        artifacts,
        prerequisites: {
          compatibleReadersMustBePublishedAndVerified: true,
          physicalOneUndEqualsOneGalMustBeConfirmed: options.scope === "all",
        },
        historicalDocumentsPreserved: true,
      });
      console.log(
        JSON.stringify({
          ...envelope,
          status: "dry-run",
          classification: plan.classification,
          targetIds: plan.targetIds,
          operator: {
            actor: options.actor.trim(),
            reason: options.reason.trim(),
          },
          physicalEquivalenceConfirmed:
            options.scope === "all" && options.confirmPhysical,
          plan: join(output, "plan.json"),
          planSha256: planFile.sha256,
          applyConfirmation: inventoryUnitScope(options.scope).applyToken,
          prerequisites:
            "No apply before verified compatible readers; scope all additionally requires confirmed 1 und = 1 gal.",
        })
      );
      return;
    }
    const operator = {
      actor: options.actor,
      reason: options.reason,
      beforeApply: saveBefore,
      beforeCommit: savePrepared,
    };
    stage =
      options.mode === "apply" ? "apply-transaction" : "restore-transaction";
    const result =
      options.mode === "apply"
        ? await applyInventoryUnitRegularization(
            client,
            input as InventoryUnitPlan,
            {
              ...operator,
              confirmation: options.confirmation!,
              confirmOneUndIsOneGal: options.confirmPhysical,
              confirmCompatibleReaders: options.confirmReaders,
              readerEvidence: options.readerEvidence,
            }
          )
        : await restoreInventoryUnitRegularization(
            client,
            input.result as InventoryUnitResult,
            { ...operator, confirmation: options.confirmation! }
          );
    committed = true;
    stage = "finalize-receipt";
    const receipt = await durableInventoryUnitWrite(output, "result.json", {
      format: "buildreq-inventory-unit-result-v2",
      ...envelope,
      status: "committed",
      completedAt: new Date().toISOString(),
      result,
      artifacts,
    });
    console.log(
      JSON.stringify({
        ...envelope,
        status: "committed",
        mode: result.mode,
        changed: result.changed,
        changedInventoryIds: result.changedInventoryIds,
        alreadyAligned: result.alreadyAligned,
        receipt: join(output, "result.json"),
        receiptSha256: receipt.sha256,
        documentFingerprint: result.fingerprints.protectedDocuments,
      })
    );
  } catch (error) {
    try {
      await durableInventoryUnitWrite(output, "failure.json", {
        ...envelope,
        stage,
        diagnostic: inventoryUnitSafeDiagnostic(error),
        status: committed
          ? "committed-audit-finalization-failed"
          : error instanceof InventoryUnitCommitOutcomeUnknownError
            ? "commit-outcome-unknown"
            : "not-committed",
        artifacts,
        observedAt: new Date().toISOString(),
      });
    } catch {}
    if (committed)
      throw new InventoryUnitRegularizationError(
        `el commit ya terminó; conserve ${output} y verifique prepared-result.json antes de cualquier reintento.`
      );
    throw error;
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(error => {
    console.error(JSON.stringify(inventoryUnitSafeDiagnostic(error)));
    process.exitCode = 1;
  });
