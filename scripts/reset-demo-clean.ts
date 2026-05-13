import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { getDb } from "../server/db.ts";
import {
  createDrizzleResetDemoCleanExecutor,
  executeResetDemoClean,
  RESET_DEMO_CLEAN_CONFIRMATION,
  type ResetDemoCleanResult,
} from "../server/_core/resetDemoClean.ts";
import { storageDelete } from "../server/storage.ts";

const execFileAsync = promisify(execFile);

type CliOptions = {
  dryRun: boolean;
  backupDir: string;
  failureReportPath: string;
  pgDumpPath: string;
  help: boolean;
};

function parseArgs(args: string[]): CliOptions {
  let confirm: string | undefined;
  let explicitDryRun = false;
  let backupDir = "backups";
  let failureReportPath = "reset-storage-failures.json";
  let pgDumpPath = "pg_dump";
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

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

  if (confirm && confirm !== RESET_DEMO_CLEAN_CONFIRMATION) {
    throw new Error(
      `Confirmacion invalida. Usa --confirm ${RESET_DEMO_CLEAN_CONFIRMATION}`
    );
  }

  return {
    dryRun: explicitDryRun || confirm !== RESET_DEMO_CLEAN_CONFIRMATION,
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

function printHelp() {
  console.log(`
Uso:
  pnpm db:reset-demo-clean -- --dry-run
  pnpm db:reset-demo-clean -- --confirm ${RESET_DEMO_CLEAN_CONFIRMATION}

Opciones:
  --dry-run                         Muestra conteos sin borrar nada (modo por defecto).
  --confirm ${RESET_DEMO_CLEAN_CONFIRMATION}  Ejecuta la limpieza real.
  --backup-dir <dir>                Carpeta para el backup pg_dump (default: backups).
  --pg-dump-path <path>             Ruta exacta de pg_dump si no esta en PATH.
  --storage-failure-report <path>   Reporte JSON si falla borrar archivos fisicos.
`);
}

async function createBackup(
  databaseUrl: string,
  backupDir: string,
  pgDumpPath: string
) {
  const resolvedBackupDir = resolve(process.cwd(), backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });

  const backupPath = resolve(
    resolvedBackupDir,
    `buildreq-reset-demo-clean-${formatTimestamp(new Date())}.sql`
  );

  try {
    await execFileAsync(
      pgDumpPath,
      [
        "--format=plain",
        "--no-owner",
        "--no-privileges",
        "--file",
        backupPath,
        databaseUrl,
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (error) {
    const details =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(
      `No se pudo crear el backup obligatorio con ${pgDumpPath}. ${details}`
    );
  }

  return backupPath;
}

function formatTimestamp(date: Date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

function printResult(result: ResetDemoCleanResult) {
  console.log(result.dryRun ? "Modo: dry-run" : "Modo: ejecucion real");
  console.log("");
  console.log("Conteos:");

  for (const [key, value] of Object.entries(result.counts)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log("");
  console.log(`Adjuntos operativos detectados: ${result.attachmentFileKeys.length}`);
  console.log(
    `Storage: intentados=${result.storage.attempted}, borrados=${result.storage.deleted}, fallidos=${result.storage.failed.length}`
  );

  if (result.storage.failureReportPath) {
    console.log(`Reporte de fallos de storage: ${result.storage.failureReportPath}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurada");
  }

  const db = await getDb();
  if (!db) throw new Error("DB not available");

  if (!options.dryRun) {
    console.log("Creando backup obligatorio con pg_dump...");
    const backupPath = await createBackup(
      process.env.DATABASE_URL,
      options.backupDir,
      options.pgDumpPath
    );
    console.log(`Backup creado: ${backupPath}`);
  }

  const result = await executeResetDemoClean(
    createDrizzleResetDemoCleanExecutor(db),
    {
      dryRun: options.dryRun,
      storageDelete,
      failureReportPath: resolve(process.cwd(), options.failureReportPath),
      logger: console,
    }
  );

  printResult(result);

  if (result.storage.failed.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
