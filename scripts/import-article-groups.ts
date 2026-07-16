import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client, type PoolClient } from "pg";
import XLSX from "xlsx";

const execFileAsync = promisify(execFile);

const DEFAULT_SHEET_NAME = "Hoja1";
const DEFAULT_BACKUP_DIR = "backups";
const DEFAULT_REPORT_DIR = "reports/article-group-imports";
const BATCH_SIZE = 500;

type ImportMode = "dry-run" | "apply";

export type CliOptions = {
  mode: ImportMode;
  file: string | null;
  sheetName: string;
  reportPath: string | null;
  backupDir: string;
  pgDumpPath: string;
  help: boolean;
};

type RawSheetRow = Record<string, unknown>;

export type ParsedArticleGroupRow = {
  rowNumber: number;
  itemCode: string;
  itemGroup: string;
};

export type SkippedRow = {
  rowNumber: number;
  reason: string;
  itemCode: string | null;
  itemGroup: string | null;
};

export type DuplicateGroup = {
  itemCode: string;
  sourceRows: number[];
  selectedGroup: string;
  hasConflict: boolean;
  values: Array<{
    rowNumber: number;
    itemGroup: string;
  }>;
};

export type GroupedArticleGroupRow = {
  itemCode: string;
  itemGroup: string;
  sourceRows: number[];
  duplicateRows: number[];
};

export type ParseResult = {
  sheetName: string;
  rawRows: number;
  parsedRows: ParsedArticleGroupRow[];
  skippedRows: SkippedRow[];
  groupedRows: GroupedArticleGroupRow[];
  duplicateGroups: DuplicateGroup[];
  conflictingDuplicateGroups: DuplicateGroup[];
  validationErrors: string[];
};

export type ExistingArticleGroupRow = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  tipoArticulo: number;
  isActive: boolean;
};

export type PlannedArticleGroupUpdate = {
  id: number;
  itemCode: string;
  itemGroup: string;
  sourceRows: number[];
  previous: ExistingArticleGroupRow;
};

export type UnchangedArticleGroup = {
  id: number;
  itemCode: string;
  itemGroup: string;
  sourceRows: number[];
  previous: ExistingArticleGroupRow;
};

export type MissingArticleGroup = GroupedArticleGroupRow;

export type ImportPlan = {
  updates: PlannedArticleGroupUpdate[];
  unchanged: UnchangedArticleGroup[];
  missingCatalogCodes: MissingArticleGroup[];
  validationErrors: string[];
};

export type Verification = {
  importedCodesFound: number;
  groupMismatches: Array<{
    itemCode: string;
    expected: string;
    actual: string | null;
  }>;
};

export type ImportReport = {
  generatedAt: string;
  mode: ImportMode;
  file: string;
  sheetName: string;
  backupPath: string | null;
  snapshotPath: string | null;
  summary: {
    rawRows: number;
    parsedRows: number;
    uniqueCodes: number;
    skippedRows: number;
    duplicateCodes: number;
    conflictingDuplicateCodes: number;
    missingCatalogCodes: number;
    updates: number;
    unchanged: number;
  };
  applyResult?: {
    updated: number;
  };
  skippedRows: SkippedRow[];
  duplicateGroups: DuplicateGroup[];
  conflictingDuplicateGroups: DuplicateGroup[];
  missingCatalogCodes: MissingArticleGroup[];
  updatedRows: PlannedArticleGroupUpdate[];
  unchangedRows: UnchangedArticleGroup[];
  validationErrors: string[];
  verification?: Verification;
};

function readValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta valor para ${flag}`);
  }
  return value;
}

export function parseArticleGroupsArgs(
  args: string[] = process.argv.slice(2)
): CliOptions {
  let mode: ImportMode = "dry-run";
  let file: string | null = null;
  let sheetName = DEFAULT_SHEET_NAME;
  let reportPath: string | null = null;
  let backupDir = DEFAULT_BACKUP_DIR;
  let pgDumpPath = "pg_dump";
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--mode") {
      const value = readValue(args, index, arg);
      if (value !== "dry-run" && value !== "apply") {
        throw new Error("--mode debe ser dry-run o apply");
      }
      mode = value;
      index += 1;
      continue;
    }
    if (arg === "--file") {
      file = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--sheet") {
      sheetName = readValue(args, index, arg);
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
    if (arg === "--pg-dump-path") {
      pgDumpPath = readValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Argumento no reconocido: ${arg}`);
  }

  return {
    mode,
    file,
    sheetName,
    reportPath,
    backupDir,
    pgDumpPath,
    help,
  };
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function getField(row: RawSheetRow, headerByNormalizedName: Map<string, string>, name: string) {
  const actualHeader = headerByNormalizedName.get(normalizeHeader(name));
  return actualHeader ? row[actualHeader] : undefined;
}

function validateHeaders(rows: RawSheetRow[]) {
  const headers = Object.keys(rows[0] ?? {});
  const headerByNormalizedName = new Map(
    headers.map(header => [normalizeHeader(header), header])
  );
  const missingHeaders = ["CODIGO", "Grupo"].filter(
    header => !headerByNormalizedName.has(normalizeHeader(header))
  );

  if (missingHeaders.length > 0) {
    throw new Error(`Faltan encabezados requeridos: ${missingHeaders.join(", ")}`);
  }

  return headerByNormalizedName;
}

export function parseArticleGroupRows(
  rows: RawSheetRow[],
  sheetName = DEFAULT_SHEET_NAME
): ParseResult {
  const headerByNormalizedName = validateHeaders(rows);
  const parsedRows: ParsedArticleGroupRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const validationErrors: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const itemCode = normalizeCell(getField(row, headerByNormalizedName, "CODIGO"));
    const itemGroup = normalizeCell(getField(row, headerByNormalizedName, "Grupo"));

    if (!itemCode && !itemGroup) {
      skippedRows.push({
        rowNumber,
        reason: "Fila vacia",
        itemCode: null,
        itemGroup: null,
      });
      continue;
    }

    if (!itemCode || !itemGroup) {
      skippedRows.push({
        rowNumber,
        reason: "CODIGO y Grupo son obligatorios",
        itemCode: itemCode || null,
        itemGroup: itemGroup || null,
      });
      validationErrors.push(`Fila ${rowNumber}: CODIGO y Grupo son obligatorios`);
      continue;
    }

    if (itemCode.length > 50) {
      skippedRows.push({
        rowNumber,
        reason: "CODIGO excede 50 caracteres",
        itemCode,
        itemGroup,
      });
      validationErrors.push(`Fila ${rowNumber}: CODIGO excede 50 caracteres`);
      continue;
    }

    if (itemGroup.length > 255) {
      skippedRows.push({
        rowNumber,
        reason: "Grupo excede 255 caracteres",
        itemCode,
        itemGroup,
      });
      validationErrors.push(`Fila ${rowNumber}: Grupo excede 255 caracteres`);
      continue;
    }

    parsedRows.push({ rowNumber, itemCode, itemGroup });
  }

  const rowsByCode = new Map<string, ParsedArticleGroupRow[]>();
  for (const row of parsedRows) {
    const bucket = rowsByCode.get(row.itemCode) ?? [];
    bucket.push(row);
    rowsByCode.set(row.itemCode, bucket);
  }

  const groupedRows: GroupedArticleGroupRow[] = [];
  const duplicateGroups: DuplicateGroup[] = [];
  const conflictingDuplicateGroups: DuplicateGroup[] = [];

  for (const [itemCode, bucket] of Array.from(rowsByCode.entries())) {
    const [selected] = bucket;
    groupedRows.push({
      itemCode,
      itemGroup: selected.itemGroup,
      sourceRows: bucket.map(row => row.rowNumber),
      duplicateRows: bucket.slice(1).map(row => row.rowNumber),
    });

    if (bucket.length <= 1) continue;

    const hasConflict = bucket.some(row => row.itemGroup !== selected.itemGroup);
    const duplicateGroup = {
      itemCode,
      sourceRows: bucket.map(row => row.rowNumber),
      selectedGroup: selected.itemGroup,
      hasConflict,
      values: bucket.map(row => ({
        rowNumber: row.rowNumber,
        itemGroup: row.itemGroup,
      })),
    };
    duplicateGroups.push(duplicateGroup);

    if (hasConflict) {
      conflictingDuplicateGroups.push(duplicateGroup);
      validationErrors.push(
        `Codigo ${itemCode}: aparece con mas de un Grupo en filas ${duplicateGroup.sourceRows.join(", ")}`
      );
    }
  }

  return {
    sheetName,
    rawRows: rows.length,
    parsedRows,
    skippedRows,
    groupedRows: groupedRows.sort((left, right) =>
      left.itemCode.localeCompare(right.itemCode)
    ),
    duplicateGroups: duplicateGroups.sort((left, right) =>
      left.itemCode.localeCompare(right.itemCode)
    ),
    conflictingDuplicateGroups: conflictingDuplicateGroups.sort((left, right) =>
      left.itemCode.localeCompare(right.itemCode)
    ),
    validationErrors,
  };
}

export function loadArticleGroupsWorkbook(filePath: string, sheetName: string) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(
      `No existe la hoja ${sheetName}. Hojas disponibles: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rows = XLSX.utils.sheet_to_json<RawSheetRow>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });

  return parseArticleGroupRows(rows, sheetName);
}

function chunkItems<T>(items: T[], size = BATCH_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadCatalogRows(
  client: Client | PoolClient,
  itemCodes: string[]
) {
  const rows: ExistingArticleGroupRow[] = [];
  const uniqueCodes = Array.from(new Set(itemCodes));

  for (const chunk of chunkItems(uniqueCodes)) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingArticleGroupRow>(
      `select id,
              "itemCode",
              description,
              "itemGroup",
              "tipoArticulo",
              "isActive"
         from "sapCatalog"
        where "itemCode" = any($1::text[])
        order by "itemCode"`,
      [chunk]
    );
    rows.push(...result.rows);
  }

  return rows;
}

export function buildArticleGroupsImportPlan(
  parseResult: ParseResult,
  existingRows: ExistingArticleGroupRow[]
): ImportPlan {
  const existingByCode = new Map(existingRows.map(row => [row.itemCode, row]));
  const updates: PlannedArticleGroupUpdate[] = [];
  const unchanged: UnchangedArticleGroup[] = [];
  const missingCatalogCodes: MissingArticleGroup[] = [];

  for (const row of parseResult.groupedRows) {
    const existing = existingByCode.get(row.itemCode);
    if (!existing) {
      missingCatalogCodes.push(row);
      continue;
    }

    if ((existing.itemGroup ?? "") === row.itemGroup) {
      unchanged.push({
        id: existing.id,
        itemCode: row.itemCode,
        itemGroup: row.itemGroup,
        sourceRows: row.sourceRows,
        previous: existing,
      });
      continue;
    }

    updates.push({
      id: existing.id,
      itemCode: row.itemCode,
      itemGroup: row.itemGroup,
      sourceRows: row.sourceRows,
      previous: existing,
    });
  }

  const validationErrors = [...parseResult.validationErrors];
  if (missingCatalogCodes.length > 0) {
    validationErrors.push(
      `Hay ${missingCatalogCodes.length} codigos que no existen en sapCatalog`
    );
  }

  return {
    updates,
    unchanged,
    missingCatalogCodes,
    validationErrors,
  };
}

function formatTimestamp(date: Date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

export async function createArticleGroupsImportBackup(params: {
  databaseUrl: string;
  backupDir: string;
  pgDumpPath: string;
  timestamp?: Date;
}) {
  const resolvedBackupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });
  const backupPath = resolve(
    resolvedBackupDir,
    `buildreq-before-article-groups-import-${formatTimestamp(params.timestamp ?? new Date())}.sql`
  );

  try {
    await execFileAsync(
      params.pgDumpPath,
      [
        "--format=plain",
        "--no-owner",
        "--no-privileges",
        "--file",
        backupPath,
        params.databaseUrl,
      ],
      { maxBuffer: 100 * 1024 * 1024 }
    );
  } catch (error) {
    const details =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(
      `No se pudo crear el backup obligatorio con ${params.pgDumpPath}. ${details}`
    );
  }

  return backupPath;
}

export async function createArticleGroupsSnapshotBackup(params: {
  client: Client | PoolClient;
  backupDir: string;
  itemCodes: string[];
  timestamp?: Date;
}) {
  const resolvedBackupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });
  const snapshotPath = resolve(
    resolvedBackupDir,
    `buildreq-before-article-groups-import-${formatTimestamp(params.timestamp ?? new Date())}.snapshot.json`
  );
  const rows = await loadCatalogRows(params.client, params.itemCodes);

  await writeFile(
    snapshotPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        table: "sapCatalog",
        rowCount: rows.length,
        rows,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return snapshotPath;
}

async function updateCatalogGroups(
  client: Client | PoolClient,
  updates: PlannedArticleGroupUpdate[]
) {
  let updated = 0;
  for (const chunk of chunkItems(updates)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `update "sapCatalog" as catalog
          set "itemGroup" = x."itemGroup",
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           "itemGroup" text
         )
        where catalog.id = x.id`,
      [JSON.stringify(chunk.map(row => ({ id: row.id, itemGroup: row.itemGroup })))]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

async function applyImportPlan(
  client: Client | PoolClient,
  plan: ImportPlan
) {
  await client.query("BEGIN");
  try {
    const updated = await updateCatalogGroups(client, plan.updates);
    await client.query("COMMIT");
    return { updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function verifyImport(
  client: Client | PoolClient,
  updates: PlannedArticleGroupUpdate[]
): Promise<Verification> {
  const expectedByCode = new Map(updates.map(row => [row.itemCode, row.itemGroup]));
  const rows = await loadCatalogRows(client, updates.map(row => row.itemCode));
  const groupMismatches = rows
    .map(row => {
      const expected = expectedByCode.get(row.itemCode);
      if (!expected || (row.itemGroup ?? null) === expected) return null;
      return {
        itemCode: row.itemCode,
        expected,
        actual: row.itemGroup ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    importedCodesFound: rows.length,
    groupMismatches,
  };
}

function buildReport(params: {
  mode: ImportMode;
  file: string;
  parseResult: ParseResult;
  plan: ImportPlan;
  backupPath: string | null;
  snapshotPath: string | null;
  applyResult?: ImportReport["applyResult"];
  verification?: Verification;
}): ImportReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    file: params.file,
    sheetName: params.parseResult.sheetName,
    backupPath: params.backupPath,
    snapshotPath: params.snapshotPath,
    summary: {
      rawRows: params.parseResult.rawRows,
      parsedRows: params.parseResult.parsedRows.length,
      uniqueCodes: params.parseResult.groupedRows.length,
      skippedRows: params.parseResult.skippedRows.length,
      duplicateCodes: params.parseResult.duplicateGroups.length,
      conflictingDuplicateCodes:
        params.parseResult.conflictingDuplicateGroups.length,
      missingCatalogCodes: params.plan.missingCatalogCodes.length,
      updates: params.plan.updates.length,
      unchanged: params.plan.unchanged.length,
    },
    applyResult: params.applyResult,
    skippedRows: params.parseResult.skippedRows,
    duplicateGroups: params.parseResult.duplicateGroups,
    conflictingDuplicateGroups: params.parseResult.conflictingDuplicateGroups,
    missingCatalogCodes: params.plan.missingCatalogCodes,
    updatedRows: params.plan.updates,
    unchangedRows: params.plan.unchanged,
    validationErrors: params.plan.validationErrors,
    verification: params.verification,
  };
}

async function writeJsonReport(reportPath: string, report: ImportReport) {
  const resolvedPath = resolve(process.cwd(), reportPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function getDefaultReportPath(mode: ImportMode) {
  return `${DEFAULT_REPORT_DIR}/article-groups-${mode}-${formatTimestamp(new Date())}.json`;
}

function printHelp() {
  console.log(`
Uso:
  pnpm exec tsx scripts/import-article-groups.ts --mode dry-run --file "<updateGrupos.xlsx>"
  pnpm exec tsx scripts/import-article-groups.ts --mode apply --file "<updateGrupos.xlsx>" --pg-dump-path "<ruta pg_dump>"

Opciones:
  --mode dry-run|apply       Modo de ejecucion. Default: dry-run.
  --file <xlsx>              Archivo Excel con columnas CODIGO y Grupo.
  --sheet <nombre>           Hoja a leer. Default: ${DEFAULT_SHEET_NAME}.
  --report <json>            Ruta del reporte JSON.
  --backup-dir <dir>         Carpeta para backups. Default: backups.
  --pg-dump-path <path>      Ruta exacta de pg_dump si no esta en PATH.
`);
}

function printReportSummary(report: ImportReport, reportPath: string) {
  console.log(report.mode === "dry-run" ? "Modo: dry-run" : "Modo: apply");
  console.log(`Archivo: ${report.file}`);
  console.log(`Hoja: ${report.sheetName}`);
  console.log(`Filas leidas: ${report.summary.rawRows}`);
  console.log(`Filas validas: ${report.summary.parsedRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Duplicados: ${report.summary.duplicateCodes}`);
  console.log(`Conflictos: ${report.summary.conflictingDuplicateCodes}`);
  console.log(`Faltantes: ${report.summary.missingCatalogCodes}`);
  console.log(`Actualizar: ${report.summary.updates}`);
  console.log(`Sin cambios: ${report.summary.unchanged}`);
  if (report.applyResult) console.log(`Actualizados: ${report.applyResult.updated}`);
  if (report.verification) {
    console.log(`Verificados: ${report.verification.importedCodesFound}`);
    console.log(`Diferencias post-apply: ${report.verification.groupMismatches.length}`);
  }
  if (report.backupPath) console.log(`Backup: ${report.backupPath}`);
  if (report.snapshotPath) console.log(`Snapshot: ${report.snapshotPath}`);
  console.log(`Reporte: ${reportPath}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArticleGroupsArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.file) {
    throw new Error("Debes indicar --file <xlsx>");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurada");
  }

  const parseResult = loadArticleGroupsWorkbook(options.file, options.sheetName);
  const reportPath = options.reportPath ?? getDefaultReportPath(options.mode);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    let backupPath: string | null = null;
    let snapshotPath: string | null = null;
    let applyResult: ImportReport["applyResult"] | undefined;
    let verification: Verification | undefined;

    let existingRows = await loadCatalogRows(
      client,
      parseResult.groupedRows.map(row => row.itemCode)
    );
    let plan = buildArticleGroupsImportPlan(parseResult, existingRows);

    if (plan.validationErrors.length > 0) {
      const report = buildReport({
        mode: options.mode,
        file: options.file,
        parseResult,
        plan,
        backupPath: null,
        snapshotPath: null,
      });
      const resolvedReportPath = await writeJsonReport(reportPath, report);
      printReportSummary(report, resolvedReportPath);
      throw new Error("La plantilla tiene errores de validacion; no se aplicaron cambios");
    }

    if (options.mode === "apply") {
      const timestamp = new Date();
      console.log("Creando backup obligatorio con pg_dump...");
      backupPath = await createArticleGroupsImportBackup({
        databaseUrl: process.env.DATABASE_URL,
        backupDir: options.backupDir,
        pgDumpPath: options.pgDumpPath,
        timestamp,
      });
      console.log(`Backup creado: ${backupPath}`);
      console.log("Creando snapshot JSON de sapCatalog...");
      snapshotPath = await createArticleGroupsSnapshotBackup({
        client,
        backupDir: options.backupDir,
        itemCodes: parseResult.groupedRows.map(row => row.itemCode),
        timestamp,
      });
      console.log(`Snapshot creado: ${snapshotPath}`);

      existingRows = await loadCatalogRows(
        client,
        parseResult.groupedRows.map(row => row.itemCode)
      );
      plan = buildArticleGroupsImportPlan(parseResult, existingRows);
      if (plan.validationErrors.length > 0) {
        throw new Error("La plantilla tiene errores de validacion; no se aplicaron cambios");
      }

      applyResult = await applyImportPlan(client, plan);
      verification = await verifyImport(client, plan.updates);
      if (verification.groupMismatches.length > 0) {
        process.exitCode = 2;
      }
    }

    const report = buildReport({
      mode: options.mode,
      file: options.file,
      parseResult,
      plan,
      backupPath,
      snapshotPath,
      applyResult,
      verification,
    });
    const resolvedReportPath = await writeJsonReport(reportPath, report);
    printReportSummary(report, resolvedReportPath);
  } finally {
    await client.end();
  }
}

const scriptPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === scriptPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
