import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { getDb } from "../server/db.ts";
import {
  createDrizzleResetOperationalMovementsExecutor,
  executeResetOperationalMovements,
  RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION,
  type ResetOperationalMovementsResult,
} from "../server/_core/resetOperationalMovements.ts";
import { storageDelete } from "../server/storage.ts";

const execFileAsync = promisify(execFile);

export type ResetOperationalMovementsCliOptions = {
  dryRun: boolean;
  backupDir: string;
  failureReportPath: string;
  pgDumpPath: string;
  help: boolean;
};

export function parseResetOperationalMovementsArgs(
  args: string[]
): ResetOperationalMovementsCliOptions {
  let confirm: string | undefined;
  let explicitDryRun = false;
  let backupDir = "backups";
  let failureReportPath = "reset-operational-movements-storage-failures.json";
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

  if (confirm && confirm !== RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION) {
    throw new Error(
      `Confirmacion invalida. Usa --confirm ${RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION}`
    );
  }

  return {
    dryRun: explicitDryRun || confirm !== RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION,
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
  pnpm db:reset-movements -- --dry-run
  pnpm db:reset-movements -- --confirm ${RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION}

Opciones:
  --dry-run                         Muestra conteos sin borrar nada (modo por defecto).
  --confirm ${RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION}  Ejecuta la limpieza real.
  --backup-dir <dir>                Carpeta para el backup pg_dump (default: backups).
  --pg-dump-path <path>             Ruta exacta de pg_dump si no esta en PATH.
  --storage-failure-report <path>   Reporte JSON si falla borrar archivos fisicos.
`);
}

export async function createOperationalMovementsBackup(
  databaseUrl: string,
  backupDir: string,
  pgDumpPath: string
) {
  const resolvedBackupDir = resolve(process.cwd(), backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });

  const backupPath = resolve(
    resolvedBackupDir,
    `buildreq-reset-movements-${formatTimestamp(new Date())}.sql`
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
    const details = formatBackupError(error);
    throw new Error(
      `No se pudo crear el backup obligatorio con ${pgDumpPath}. ${details}`
    );
  }

  return backupPath;
}

function formatBackupError(error: unknown) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const execError = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
    code?: unknown;
  };
  const parts = [
    execError.stderr ? `stderr: ${String(execError.stderr).trim()}` : "",
    execError.stdout ? `stdout: ${String(execError.stdout).trim()}` : "",
    execError.message ? `mensaje: ${String(execError.message).trim()}` : "",
    execError.code ? `codigo: ${String(execError.code).trim()}` : "",
  ].filter(Boolean);

  return [
    parts.join(" | ") || String(error),
    "Revisa que pg_dump exista, que sea compatible con la version de Postgres y que DATABASE_URL sea una conexion directa valida para backup.",
    "Si pg_dump no esta en el PATH, usa --pg-dump-path con la ruta completa del ejecutable.",
  ].join(" ");
}

function formatTimestamp(date: Date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

function printResult(result: ResetOperationalMovementsResult) {
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

export async function main(args = process.argv.slice(2)) {
  const options = parseResetOperationalMovementsArgs(args);

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
    const backupPath = await createOperationalMovementsBackup(
      process.env.DATABASE_URL,
      options.backupDir,
      options.pgDumpPath
    );
    console.log(`Backup creado: ${backupPath}`);
  }

  const result = await executeResetOperationalMovements(
    createDrizzleResetOperationalMovementsExecutor(db),
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

const scriptPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === scriptPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
