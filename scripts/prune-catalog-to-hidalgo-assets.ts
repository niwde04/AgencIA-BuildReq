import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDb } from "../server/db.ts";
import {
  createDrizzleResetOperationalMovementsExecutor,
} from "../server/_core/resetOperationalMovements.ts";
import {
  executePruneCatalogToHidalgoAssets,
  HIDALGO_KEEP_CODE_COUNT,
  PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION,
  validateHidalgoKeepCodes,
  type PruneCatalogResult,
} from "../server/_core/pruneCatalogToHidalgoAssets.ts";
import { storageDelete } from "../server/storage.ts";
import { createOperationalMovementsBackup } from "./reset-operational-movements.ts";

const DEFAULT_SOURCE_REPORT =
  "reports/fixed-assets-imports/hidalgo-06072026-apply.json";
const DEFAULT_DRY_RUN_REPORT =
  "reports/fixed-assets-prune/hidalgo-06072026-dry-run.json";
const DEFAULT_APPLY_REPORT =
  "reports/fixed-assets-prune/hidalgo-06072026-apply.json";

export type PruneCatalogCliOptions = {
  dryRun: boolean;
  sourceReportPath: string;
  reportPath: string;
  backupDir: string;
  failureReportPath: string;
  pgDumpPath: string;
  help: boolean;
};

type HidalgoApplyReport = {
  insertedRows?: Array<{ itemCode?: unknown }>;
};

export function parsePruneCatalogArgs(args: string[]): PruneCatalogCliOptions {
  let confirm: string | undefined;
  let explicitDryRun = false;
  let sourceReportPath = DEFAULT_SOURCE_REPORT;
  let reportPath: string | undefined;
  let backupDir = "backups";
  let failureReportPath =
    "reports/fixed-assets-prune/hidalgo-06072026-storage-failures.json";
  let pgDumpPath = "pg_dump";
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--dry-run") {
      explicitDryRun = true;
      continue;
    }
    if (arg === "--confirm") {
      confirm = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-report") {
      sourceReportPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--report") {
      reportPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--backup-dir") {
      backupDir = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--storage-failure-report") {
      failureReportPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--pg-dump-path") {
      pgDumpPath = readValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Argumento no reconocido: ${arg}`);
  }

  if (confirm && confirm !== PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION) {
    throw new Error(
      `Confirmacion invalida. Usa --confirm ${PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION}`
    );
  }

  const dryRun = explicitDryRun || confirm !== PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION;

  return {
    dryRun,
    sourceReportPath,
    reportPath: reportPath ?? (dryRun ? DEFAULT_DRY_RUN_REPORT : DEFAULT_APPLY_REPORT),
    backupDir,
    failureReportPath,
    pgDumpPath,
    help,
  };
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta valor para ${flag}`);
  }
  return value;
}

export async function loadKeepCodesFromApplyReport(reportPath: string) {
  const report = JSON.parse(
    await readFile(resolve(process.cwd(), reportPath), "utf8")
  ) as HidalgoApplyReport;
  const keepCodes = (report.insertedRows ?? []).map(row =>
    String(row.itemCode ?? "").trim()
  );
  return validateHidalgoKeepCodes(keepCodes);
}

async function writeJsonReport(reportPath: string, report: unknown) {
  const resolvedPath = resolve(process.cwd(), reportPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function buildReport(params: {
  result: PruneCatalogResult;
  sourceReportPath: string;
  reportPath: string;
  backupPath: string | null;
}) {
  return {
    generatedAt: new Date().toISOString(),
    sourceReportPath: params.sourceReportPath,
    backupPath: params.backupPath,
    ...params.result,
  };
}

function printHelp() {
  console.log(`
Uso:
  pnpm exec tsx scripts/prune-catalog-to-hidalgo-assets.ts --dry-run
  pnpm exec tsx scripts/prune-catalog-to-hidalgo-assets.ts --confirm ${PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION}

Opciones:
  --dry-run                         Muestra conteos sin borrar nada (modo por defecto).
  --confirm ${PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION}  Ejecuta la limpieza real.
  --source-report <json>            Reporte apply con los ${HIDALGO_KEEP_CODE_COUNT} codigos a conservar.
  --report <json>                   Ruta de reporte de dry-run/apply.
  --backup-dir <dir>                Carpeta para backup pg_dump (default: backups).
  --pg-dump-path <path>             Ruta exacta de pg_dump si no esta en PATH.
  --storage-failure-report <json>   Reporte JSON si falla borrar storage.
`);
}

function printResult(result: PruneCatalogResult, reportPath: string) {
  console.log(result.dryRun ? "Modo: dry-run" : "Modo: ejecucion real");
  console.log(`Codigos Hidalgo conservados: ${result.keepCodes}`);
  console.log("");
  console.log("Antes:");
  console.log(`  sapCatalog total: ${result.before.catalog.total}`);
  console.log(`  sapCatalog conserva: ${result.before.catalog.keep}`);
  console.log(`  sapCatalog a borrar: ${result.before.catalog.nonKeep}`);
  console.log(`  inventoryItems total: ${result.before.inventory.total}`);
  console.log(`  inventoryItems a borrar: ${result.before.inventory.nonKeep}`);
  console.log(
    `  adjuntos operativos detectados: ${result.before.attachmentFileKeys.length}`
  );

  if (result.after) {
    console.log("");
    console.log("Despues:");
    console.log(`  sapCatalog total: ${result.after.catalog.total}`);
    console.log(`  sapCatalog fuera de whitelist: ${result.after.catalog.nonKeep}`);
    console.log(`  inventoryItems fuera de whitelist: ${result.after.inventory.nonKeep}`);
    console.log(
      `  storage intentados=${result.storage.attempted}, borrados=${result.storage.deleted}, fallidos=${result.storage.failed.length}`
    );
  }

  console.log(`Reporte: ${reportPath}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parsePruneCatalogArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurada");
  }

  const keepCodes = await loadKeepCodesFromApplyReport(options.sourceReportPath);
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  let backupPath: string | null = null;
  if (!options.dryRun) {
    console.log("Creando backup obligatorio con pg_dump...");
    backupPath = await createOperationalMovementsBackup(
      process.env.DATABASE_URL,
      options.backupDir,
      options.pgDumpPath
    );
    console.log(`Backup creado: ${backupPath}`);
  }

  const result = await executePruneCatalogToHidalgoAssets(
    createDrizzleResetOperationalMovementsExecutor(db),
    keepCodes,
    {
      dryRun: options.dryRun,
      storageDelete,
      failureReportPath: resolve(process.cwd(), options.failureReportPath),
      logger: console,
    }
  );
  const report = buildReport({
    result,
    sourceReportPath: options.sourceReportPath,
    reportPath: options.reportPath,
    backupPath,
  });
  const writtenReportPath = await writeJsonReport(options.reportPath, report);

  printResult(result, writtenReportPath);

  if (result.storage.failed.length > 0) {
    process.exitCode = 2;
  }
}

const scriptPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === scriptPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
