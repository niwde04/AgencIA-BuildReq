import "dotenv/config";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import {
  buildReceiptInventoryCorrectionPlan,
  type ReceiptCorrectionAuditRow,
  type ReceiptCorrectionInventoryRow,
  type ReceiptCorrectionRepairPlan,
  type ReceiptCorrectionRepairUpdate,
} from "../server/_core/receiptInventoryCorrectionAudit";

const APPLY_CONFIRMATION = "APLICAR_REPARACION_INVENTARIO_RECEPCIONES";
const DEFAULT_REPORT_DIR = "reports/receipt-inventory-corrections";

type CliOptions =
  | {
      mode: "dry-run";
      backupMetadataPath: string;
      reportPath: string | null;
    }
  | {
      mode: "apply";
      manifestPath: string;
      confirmation: string;
      reportPath: string | null;
    };

type BackupMetadata = {
  createdAt: string;
  databaseHost: string;
  databasePort: number;
  databaseName: string;
  databaseServerVersion: string;
  pgDumpVersion: string;
  format: string;
  sizeBytes: number;
  sha256: string;
  catalogEntryCount: number;
  backupFile: string;
  catalogFile: string;
};

type ValidatedBackup = BackupMetadata & {
  metadataPath: string;
  backupPath: string;
};

type AuditManifest = {
  manifestVersion: 1;
  generatedAt: string;
  mode: "dry-run";
  database: {
    host: string;
    port: string;
    name: string;
    serverVersion: string;
  };
  backup: ValidatedBackup;
  summary: {
    candidateReceipts: number;
    candidateLines: number;
    plannedInventoryRows: number;
    plannedQuantity: string;
    exceptionGroups: number;
  };
  plan: ReceiptCorrectionRepairPlan;
};

function readOptionValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta valor para ${option}`);
  }
  return value;
}

export function parseReceiptInventoryAuditArgs(args: string[]): CliOptions {
  let mode: "dry-run" | "apply" = "dry-run";
  let backupMetadataPath: string | null = null;
  let manifestPath: string | null = null;
  let confirmation: string | null = null;
  let reportPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      mode = "dry-run";
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }
    if (arg === "--backup-metadata") {
      backupMetadataPath = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--confirm") {
      confirmation = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--report") {
      reportPath = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Argumento no reconocido: ${arg}`);
  }

  if (mode === "dry-run") {
    if (!backupMetadataPath) {
      throw new Error(
        "El dry-run requiere --backup-metadata con un respaldo validado."
      );
    }
    return {
      mode,
      backupMetadataPath,
      reportPath,
    };
  }

  if (!manifestPath) {
    throw new Error("La aplicación requiere --manifest.");
  }
  if (confirmation !== APPLY_CONFIRMATION) {
    throw new Error(
      `Confirmación inválida. Use --confirm ${APPLY_CONFIRMATION}`
    );
  }
  return {
    mode,
    manifestPath,
    confirmation,
    reportPath,
  };
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function validateBackupMetadata(path: string): Promise<ValidatedBackup> {
  const metadataPath = resolve(path);
  const metadata = JSON.parse(
    await readFile(metadataPath, "utf8")
  ) as BackupMetadata;
  const backupPath = resolve(dirname(metadataPath), metadata.backupFile);
  const backupStats = await stat(backupPath);
  if (backupStats.size <= 0 || backupStats.size !== metadata.sizeBytes) {
    throw new Error("El tamaño del backup no coincide con sus metadatos.");
  }
  const sha256 = await sha256File(backupPath);
  if (sha256.toLowerCase() !== metadata.sha256.toLowerCase()) {
    throw new Error("El SHA-256 del backup no coincide con sus metadatos.");
  }
  if (metadata.format !== "custom" || metadata.catalogEntryCount <= 0) {
    throw new Error("El backup no tiene un catálogo custom válido.");
  }
  return {
    ...metadata,
    metadataPath,
    backupPath,
  };
}

async function loadAuditRows(client: Client) {
  const result = await client.query<ReceiptCorrectionAuditRow>(`
    select
      r.id as "receiptId",
      r."receiptNumber" as "receiptNumber",
      r."replacementReceiptId" as "replacementReceiptId",
      replacement."receiptNumber" as "replacementReceiptNumber",
      replacement.status::text as "replacementReceiptStatus",
      r."projectId" as "projectId",
      ri.id as "receiptItemId",
      ri."sourceItemId" as "sourceItemId",
      ri."sapItemCode" as "sapItemCode",
      ri."quantityReceived"::text as "quantityReceived",
      ri."warehouseId" as "warehouseId",
      ri."storageLocation" as "storageLocation",
      ri."fixedAssetSapItemCode" as "fixedAssetSapItemCode",
      ri."isFixedAsset" as "receiptItemIsFixedAsset",
      poi."currentSapItemCode" as "sourceCurrentSapItemCode",
      poi."originalSapItemCode" as "sourceOriginalSapItemCode",
      poi."isFixedAsset" as "sourceIsFixedAsset",
      poi."fixedAssetArticleId" as "sourceFixedAssetArticleId",
      catalog."tipoArticulo" as "catalogTipoArticulo"
    from receipts r
    inner join "receiptItems" ri on ri."receiptId" = r.id
    left join receipts replacement on replacement.id = r."replacementReceiptId"
    left join "purchaseOrderItems" poi on poi.id = ri."sourceItemId"
    left join "sapCatalog" catalog
      on catalog."itemCode" = coalesce(
        poi."currentSapItemCode",
        poi."originalSapItemCode",
        ri."sapItemCode"
      )
    where r.status = 'anulada'
      and r."replacementReceiptId" is not null
    order by r.id, ri.id
  `);
  return result.rows;
}

async function loadInventoryRows(client: Client, itemCodes: string[]) {
  if (itemCodes.length === 0) return [] as ReceiptCorrectionInventoryRow[];
  const result = await client.query<ReceiptCorrectionInventoryRow>(
    `
      select
        id,
        "sapItemCode" as "sapItemCode",
        "projectId" as "projectId",
        "warehouseId" as "warehouseId",
        "storageLocation" as "storageLocation",
        "currentStock"::text as "currentStock",
        "updatedAt" as "updatedAt"
      from "inventoryItems"
      where upper(trim(coalesce("sapItemCode", ''))) = any($1::text[])
      order by id
    `,
    [itemCodes]
  );
  return result.rows;
}

function sumPlannedQuantity(updates: ReceiptCorrectionRepairUpdate[]) {
  return updates
    .reduce(
      (total, update) => total + Number(update.skippedReversalQuantity),
      0
    )
    .toFixed(2);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path: string, value: unknown) {
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return resolvedPath;
}

async function createDryRunManifest(
  client: Client,
  backup: ValidatedBackup
): Promise<AuditManifest> {
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  const versionResult = await client.query<{
    database: string;
    serverVersion: string;
  }>(
    `select current_database() as database, current_setting('server_version') as "serverVersion"`
  );
  const auditRows = await loadAuditRows(client);
  const itemCodes = Array.from(
    new Set(
      auditRows
        .flatMap(row => [
          row.sourceCurrentSapItemCode,
          row.sourceOriginalSapItemCode,
          row.sapItemCode,
        ])
        .map(value => value?.trim().toUpperCase())
        .filter((value): value is string => Boolean(value))
    )
  );
  const inventoryRows = await loadInventoryRows(client, itemCodes);
  const plan = buildReceiptInventoryCorrectionPlan(auditRows, inventoryRows);

  return {
    manifestVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    database: {
      host: databaseUrl.hostname,
      port: databaseUrl.port || "5432",
      name: versionResult.rows[0].database,
      serverVersion: versionResult.rows[0].serverVersion,
    },
    backup,
    summary: {
      candidateReceipts: new Set(
        plan.candidateLines.map(line => line.receiptId)
      ).size,
      candidateLines: plan.candidateLines.length,
      plannedInventoryRows: plan.plannedUpdates.length,
      plannedQuantity: sumPlannedQuantity(plan.plannedUpdates),
      exceptionGroups: plan.exceptions.length,
    },
    plan,
  };
}

function decimalEquals(left: string, right: string) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

function dateEquals(left: Date | string, right: string) {
  return new Date(left).toISOString() === new Date(right).toISOString();
}

type ApplyState = "pending" | "already_applied";

export function classifyManifestApplyState(
  update: ReceiptCorrectionRepairUpdate,
  current: { currentStock: string; updatedAt: Date | string }
): ApplyState | "conflict" {
  if (decimalEquals(current.currentStock, update.currentStockAfter)) {
    return "already_applied";
  }
  if (
    decimalEquals(current.currentStock, update.currentStockBefore) &&
    dateEquals(current.updatedAt, update.expectedUpdatedAt)
  ) {
    return "pending";
  }
  return "conflict";
}

async function applyManifest(
  client: Client,
  manifest: AuditManifest,
  manifestSha256: string
) {
  const updates = manifest.plan.plannedUpdates;
  const ids = updates.map(update => update.inventoryItemId);
  const appliedAt = new Date();

  await client.query("begin");
  try {
    await client.query(
      `lock table "inventoryItems" in share row exclusive mode`
    );
    const rows =
      ids.length > 0
        ? await client.query<{
            id: number;
            currentStock: string;
            updatedAt: Date;
          }>(
            `
              select
                id,
                "currentStock"::text as "currentStock",
                "updatedAt" as "updatedAt"
              from "inventoryItems"
              where id = any($1::int[])
              order by id
              for update
            `,
            [ids]
          )
        : { rows: [] };
    const currentById = new Map(rows.rows.map(row => [row.id, row]));
    const states = updates.map(update => {
      const current = currentById.get(update.inventoryItemId);
      if (!current) {
        return { update, state: "conflict" as const, current: null };
      }
      return {
        update,
        state: classifyManifestApplyState(update, current),
        current,
      };
    });
    const conflicts = states.filter(entry => entry.state === "conflict");
    if (conflicts.length > 0) {
      throw new Error(
        `El manifiesto tiene ${conflicts.length} conflicto(s) de saldo o fecha; no se aplicó ningún cambio.`
      );
    }
    const pending = states.filter(entry => entry.state === "pending");
    const alreadyApplied = states.filter(
      entry => entry.state === "already_applied"
    );
    if (pending.length > 0 && alreadyApplied.length > 0) {
      throw new Error(
        "El manifiesto está parcialmente aplicado; se detuvo para revisión."
      );
    }

    for (const entry of pending) {
      await client.query(
        `
          update "inventoryItems"
          set "currentStock" = $2::numeric, "updatedAt" = $3
          where id = $1
        `,
        [
          entry.update.inventoryItemId,
          entry.update.currentStockAfter,
          appliedAt,
        ]
      );
    }

    const verification =
      ids.length > 0
        ? await client.query<{ id: number; currentStock: string }>(
            `
              select id, "currentStock"::text as "currentStock"
              from "inventoryItems"
              where id = any($1::int[])
              order by id
            `,
            [ids]
          )
        : { rows: [] };
    const verifiedById = new Map(
      verification.rows.map(row => [row.id, row.currentStock])
    );
    for (const update of updates) {
      const verified = verifiedById.get(update.inventoryItemId);
      if (!verified || !decimalEquals(verified, update.currentStockAfter)) {
        throw new Error(
          `Falló la verificación de inventoryItems ${update.inventoryItemId}.`
        );
      }
    }

    await client.query("commit");
    return {
      appliedAt: appliedAt.toISOString(),
      manifestSha256,
      status:
        pending.length > 0
          ? ("applied" as const)
          : ("already_applied" as const),
      updatedRows: pending.length,
      alreadyAppliedRows: alreadyApplied.length,
      verification: updates.map(update => ({
        inventoryItemId: update.inventoryItemId,
        expectedStock: update.currentStockAfter,
        actualStock: verifiedById.get(update.inventoryItemId),
      })),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  const options = parseReceiptInventoryAuditArgs(process.argv.slice(2));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (options.mode === "dry-run") {
      const backup = await validateBackupMetadata(options.backupMetadataPath);
      const manifest = await createDryRunManifest(client, backup);
      const reportPath =
        options.reportPath ??
        `${DEFAULT_REPORT_DIR}/receipt-inventory-corrections-${timestamp()}-dry-run.json`;
      const writtenPath = await writeJson(reportPath, manifest);
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            reportPath: writtenPath,
            backupSha256: backup.sha256,
            summary: manifest.summary,
          },
          null,
          2
        )
      );
      return;
    }

    const manifestPath = resolve(options.manifestPath);
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as AuditManifest;
    if (manifest.manifestVersion !== 1 || manifest.mode !== "dry-run") {
      throw new Error("El archivo indicado no es un manifiesto compatible.");
    }
    const backup = await validateBackupMetadata(manifest.backup.metadataPath);
    if (backup.sha256 !== manifest.backup.sha256) {
      throw new Error("El backup validado no coincide con el manifiesto.");
    }
    const manifestSha256 = createHash("sha256")
      .update(manifestRaw)
      .digest("hex");
    const applyResult = await applyManifest(
      client,
      manifest,
      manifestSha256
    );
    const verifiedStockById = new Map(
      applyResult.verification.map(row => [
        row.inventoryItemId,
        row.actualStock,
      ])
    );
    const reportPath =
      options.reportPath ??
      `${DEFAULT_REPORT_DIR}/receipt-inventory-corrections-${timestamp()}-apply.json`;
    const writtenPath = await writeJson(reportPath, {
      generatedAt: new Date().toISOString(),
      mode: "apply",
      manifestPath,
      backup,
      summary: manifest.summary,
      exceptions: manifest.plan.exceptions,
      repairs: manifest.plan.plannedUpdates.map(update => ({
        ...update,
        actualStockAfter: verifiedStockById.get(update.inventoryItemId),
      })),
      applyResult,
    });
    console.log(
      JSON.stringify(
        {
          mode: "apply",
          reportPath: writtenPath,
          applyResult,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { APPLY_CONFIRMATION };
