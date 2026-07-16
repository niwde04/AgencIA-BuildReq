import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client, type PoolClient } from "pg";
import XLSX from "xlsx";

const execFileAsync = promisify(execFile);
const DEFAULT_SHEET_NAME = "Articulo a Actualizar";
const DEFAULT_BACKUP_DIR = "backups";
const DEFAULT_REPORT_DIR = "reports/financial-group-imports";
const BATCH_SIZE = 500;

type ImportMode = "dry-run" | "apply";

type CliOptions = {
  mode: ImportMode;
  file: string | null;
  sheetName: string;
  reportPath: string | null;
  backupDir: string;
  pgDumpPath: string;
};

export type ParsedFinancialGroupRow = {
  rowNumber: number;
  itemCode: string;
  financialGroupCode: string;
};

type GroupedFinancialGroupRow = {
  itemCode: string;
  financialGroupCode: string;
  sourceRows: number[];
  duplicateRows: number[];
};

type SkippedRow = {
  rowNumber: number;
  reason: string;
  itemCode: string | null;
  financialGroupCode: string | null;
};

type DuplicateGroup = {
  itemCode: string;
  sourceRows: number[];
  selectedFinancialGroupCode: string;
  hasConflict: boolean;
  values: Array<{ rowNumber: number; financialGroupCode: string }>;
};

export type FinancialGroupParseResult = {
  sheetName: string;
  headerRowNumber: number;
  rawRows: number;
  parsedRows: ParsedFinancialGroupRow[];
  skippedRows: SkippedRow[];
  groupedRows: GroupedFinancialGroupRow[];
  duplicateGroups: DuplicateGroup[];
  conflictingDuplicateGroups: DuplicateGroup[];
  validationErrors: string[];
};

export type ExistingFinancialGroupArticle = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  financialGroupCode: string | null;
  tipoArticulo: number;
  isActive: boolean;
  createdById: number | null;
  updatedById: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExistingFinancialGroup = {
  financialGroupCode: string;
  financialGroupDescription: string;
  isActive: boolean;
};

type PlannedFinancialGroupUpdate = {
  id: number;
  itemCode: string;
  financialGroupCode: string;
  sourceRows: number[];
  previous: ExistingFinancialGroupArticle;
};

type UnchangedFinancialGroup = PlannedFinancialGroupUpdate;

type FinancialGroupImportPlan = {
  updates: PlannedFinancialGroupUpdate[];
  unchanged: UnchangedFinancialGroup[];
  missingCatalogCodes: GroupedFinancialGroupRow[];
  missingFinancialGroups: string[];
  inactiveFinancialGroups: string[];
  validationErrors: string[];
};

type VerificationMismatch = {
  itemCode: string;
  expected: string;
  actual: string | null;
};

type Verification = {
  importedCodesFound: number;
  groupMismatches: VerificationMismatch[];
};

type ImportReport = {
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
    missingFinancialGroups: number;
    inactiveFinancialGroups: number;
    updates: number;
    unchanged: number;
  };
  applyResult?: { updated: number };
  verification?: Verification;
  skippedRows: SkippedRow[];
  duplicateGroups: DuplicateGroup[];
  conflictingDuplicateGroups: DuplicateGroup[];
  missingCatalogCodes: GroupedFinancialGroupRow[];
  missingFinancialGroups: string[];
  inactiveFinancialGroups: string[];
  updatedRows: PlannedFinancialGroupUpdate[];
  unchangedRows: UnchangedFinancialGroup[];
  validationErrors: string[];
};

function readValue(args: string[], index: number, option: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta valor para ${option}`);
  }
  return value;
}

export function parseFinancialGroupImportArgs(args: string[]): CliOptions {
  let mode: ImportMode = "dry-run";
  let file: string | null = null;
  let sheetName = DEFAULT_SHEET_NAME;
  let reportPath: string | null = null;
  let backupDir = DEFAULT_BACKUP_DIR;
  let pgDumpPath = "pg_dump";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      const value = readValue(args, index, arg);
      if (value !== "dry-run" && value !== "apply") {
        throw new Error("--mode debe ser dry-run o apply");
      }
      mode = value;
      index += 1;
    } else if (arg === "--file") {
      file = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--sheet") {
      sheetName = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--report") {
      reportPath = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--backup-dir") {
      backupDir = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--pg-dump-path") {
      pgDumpPath = readValue(args, index, arg);
      index += 1;
    } else if (arg !== "--help") {
      throw new Error(`Opcion no reconocida: ${arg}`);
    }
  }

  return { mode, file, sheetName, reportPath, backupDir, pgDumpPath };
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: unknown) {
  return normalizeCell(value).toLocaleLowerCase("es-HN");
}

export function parseFinancialGroupSheetRows(
  rows: unknown[][],
  sheetName = DEFAULT_SHEET_NAME
): FinancialGroupParseResult {
  if (rows.length < 2) {
    throw new Error("La hoja no contiene la fila de encabezados esperada");
  }

  const headers = rows[1] ?? [];
  const headerIndex = new Map(
    headers.map((header, index) => [normalizeHeader(header), index])
  );
  const itemCodeIndex = headerIndex.get(normalizeHeader("CODIGO"));
  const financialGroupCodeIndex = headerIndex.get(normalizeHeader("CodN4"));
  const missingHeaders = [
    itemCodeIndex === undefined ? "CODIGO" : null,
    financialGroupCodeIndex === undefined ? "CodN4" : null,
  ].filter(Boolean);
  if (missingHeaders.length > 0) {
    throw new Error(
      `Faltan encabezados requeridos: ${missingHeaders.join(", ")}`
    );
  }

  const parsedRows: ParsedFinancialGroupRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const validationErrors: string[] = [];

  for (let index = 2; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    const itemCode = normalizeCell(row[itemCodeIndex!]);
    const financialGroupCode = normalizeCell(row[financialGroupCodeIndex!]);

    if (!itemCode && !financialGroupCode) {
      skippedRows.push({
        rowNumber,
        reason: "Fila vacia",
        itemCode: null,
        financialGroupCode: null,
      });
      continue;
    }
    if (itemCode && !financialGroupCode) {
      skippedRows.push({
        rowNumber,
        reason: "CodN4 vacio; no se limpiara la asignacion existente",
        itemCode,
        financialGroupCode: null,
      });
      continue;
    }
    if (!itemCode) {
      const message = `Fila ${rowNumber}: CODIGO es obligatorio`;
      skippedRows.push({
        rowNumber,
        reason: message,
        itemCode: null,
        financialGroupCode,
      });
      validationErrors.push(message);
      continue;
    }
    if (itemCode.length > 50) {
      const message = `Fila ${rowNumber}: CODIGO excede 50 caracteres`;
      skippedRows.push({
        rowNumber,
        reason: message,
        itemCode,
        financialGroupCode,
      });
      validationErrors.push(message);
      continue;
    }
    if (!/^\d{8}$/.test(financialGroupCode)) {
      const message = `Fila ${rowNumber}: CodN4 debe contener 8 digitos`;
      skippedRows.push({
        rowNumber,
        reason: message,
        itemCode,
        financialGroupCode,
      });
      validationErrors.push(message);
      continue;
    }

    parsedRows.push({ rowNumber, itemCode, financialGroupCode });
  }

  const rowsByCode = new Map<string, ParsedFinancialGroupRow[]>();
  for (const row of parsedRows) {
    const bucket = rowsByCode.get(row.itemCode) ?? [];
    bucket.push(row);
    rowsByCode.set(row.itemCode, bucket);
  }

  const groupedRows: GroupedFinancialGroupRow[] = [];
  const duplicateGroups: DuplicateGroup[] = [];
  const conflictingDuplicateGroups: DuplicateGroup[] = [];

  for (const [itemCode, bucket] of Array.from(rowsByCode.entries())) {
    const [selected] = bucket;
    groupedRows.push({
      itemCode,
      financialGroupCode: selected.financialGroupCode,
      sourceRows: bucket.map(row => row.rowNumber),
      duplicateRows: bucket.slice(1).map(row => row.rowNumber),
    });
    if (bucket.length <= 1) continue;

    const hasConflict = bucket.some(
      row => row.financialGroupCode !== selected.financialGroupCode
    );
    const duplicate = {
      itemCode,
      sourceRows: bucket.map(row => row.rowNumber),
      selectedFinancialGroupCode: selected.financialGroupCode,
      hasConflict,
      values: bucket.map(row => ({
        rowNumber: row.rowNumber,
        financialGroupCode: row.financialGroupCode,
      })),
    };
    duplicateGroups.push(duplicate);
    if (hasConflict) {
      conflictingDuplicateGroups.push(duplicate);
      validationErrors.push(
        `Codigo ${itemCode}: aparece con mas de un CodN4 en filas ${duplicate.sourceRows.join(", ")}`
      );
    }
  }

  return {
    sheetName,
    headerRowNumber: 2,
    rawRows: Math.max(rows.length - 2, 0),
    parsedRows,
    skippedRows,
    groupedRows: groupedRows.sort((a, b) =>
      a.itemCode.localeCompare(b.itemCode)
    ),
    duplicateGroups,
    conflictingDuplicateGroups,
    validationErrors,
  };
}

export function loadFinancialGroupWorkbook(
  filePath: string,
  sheetName: string
) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(
      `No existe la hoja ${sheetName}. Hojas disponibles: ${workbook.SheetNames.join(", ")}`
    );
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  });
  return parseFinancialGroupSheetRows(rows, sheetName);
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
  const rows: ExistingFinancialGroupArticle[] = [];
  for (const chunk of chunkItems(Array.from(new Set(itemCodes)))) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingFinancialGroupArticle>(
      `select id,
              "itemCode",
              description,
              "itemGroup",
              "financialGroupCode",
              "tipoArticulo",
              "isActive",
              "createdById",
              "updatedById",
              "createdAt",
              "updatedAt"
         from "sapCatalog"
        where "itemCode" = any($1::text[])
        order by "itemCode"`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return rows;
}

async function loadFinancialGroups(
  client: Client | PoolClient,
  financialGroupCodes: string[]
) {
  const result = await client.query<ExistingFinancialGroup>(
    `select "financialGroupCode", "financialGroupDescription", "isActive"
       from "financialGroups"
      where "financialGroupCode" = any($1::text[])
      order by "financialGroupCode"`,
    [Array.from(new Set(financialGroupCodes))]
  );
  return result.rows;
}

export function buildFinancialGroupImportPlan(
  parseResult: FinancialGroupParseResult,
  existingRows: ExistingFinancialGroupArticle[],
  existingGroups: ExistingFinancialGroup[]
): FinancialGroupImportPlan {
  const existingByCode = new Map(existingRows.map(row => [row.itemCode, row]));
  const groupsByCode = new Map(
    existingGroups.map(group => [group.financialGroupCode, group])
  );
  const requestedGroupCodes = Array.from(
    new Set(parseResult.groupedRows.map(row => row.financialGroupCode))
  );
  const missingFinancialGroups = requestedGroupCodes.filter(
    code => !groupsByCode.has(code)
  );
  const inactiveFinancialGroups = requestedGroupCodes.filter(
    code => groupsByCode.get(code)?.isActive === false
  );
  const invalidGroupCodes = new Set([
    ...missingFinancialGroups,
    ...inactiveFinancialGroups,
  ]);
  const updates: PlannedFinancialGroupUpdate[] = [];
  const unchanged: UnchangedFinancialGroup[] = [];
  const missingCatalogCodes: GroupedFinancialGroupRow[] = [];

  for (const row of parseResult.groupedRows) {
    const existing = existingByCode.get(row.itemCode);
    if (!existing) {
      missingCatalogCodes.push(row);
      continue;
    }
    if (invalidGroupCodes.has(row.financialGroupCode)) continue;

    const planned = {
      id: existing.id,
      itemCode: row.itemCode,
      financialGroupCode: row.financialGroupCode,
      sourceRows: row.sourceRows,
      previous: existing,
    };
    if (existing.financialGroupCode === row.financialGroupCode) {
      unchanged.push(planned);
    } else {
      updates.push(planned);
    }
  }

  const validationErrors = [...parseResult.validationErrors];
  if (missingFinancialGroups.length > 0) {
    validationErrors.push(
      `Hay ${missingFinancialGroups.length} grupos financieros inexistentes`
    );
  }
  if (inactiveFinancialGroups.length > 0) {
    validationErrors.push(
      `Hay ${inactiveFinancialGroups.length} grupos financieros inactivos`
    );
  }

  return {
    updates,
    unchanged,
    missingCatalogCodes,
    missingFinancialGroups,
    inactiveFinancialGroups,
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

export async function createFinancialGroupImportBackup(params: {
  databaseUrl: string;
  backupDir: string;
  pgDumpPath: string;
  timestamp?: Date;
}) {
  const backupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(backupDir, { recursive: true });
  const backupPath = resolve(
    backupDir,
    `buildreq-before-financial-groups-import-${formatTimestamp(params.timestamp ?? new Date())}.sql`
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
    throw new Error(`No se pudo crear el backup obligatorio. ${details}`);
  }
  return backupPath;
}

export async function createFinancialGroupSnapshot(params: {
  client: Client | PoolClient;
  backupDir: string;
  itemCodes: string[];
  timestamp?: Date;
}) {
  const backupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(backupDir, { recursive: true });
  const snapshotPath = resolve(
    backupDir,
    `buildreq-before-financial-groups-import-${formatTimestamp(params.timestamp ?? new Date())}.snapshot.json`
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

async function updateFinancialGroups(
  client: Client | PoolClient,
  updates: PlannedFinancialGroupUpdate[]
) {
  let updated = 0;
  for (const chunk of chunkItems(updates)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `update "sapCatalog" as catalog
          set "financialGroupCode" = x."financialGroupCode",
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           "financialGroupCode" text
         )
        where catalog.id = x.id`,
      [
        JSON.stringify(
          chunk.map(row => ({
            id: row.id,
            financialGroupCode: row.financialGroupCode,
          }))
        ),
      ]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

async function verifyImport(
  client: Client | PoolClient,
  updates: PlannedFinancialGroupUpdate[]
): Promise<Verification> {
  const expectedByCode = new Map(
    updates.map(row => [row.itemCode, row.financialGroupCode])
  );
  const rows = await loadCatalogRows(
    client,
    updates.map(row => row.itemCode)
  );
  const groupMismatches = rows.flatMap(row => {
    const expected = expectedByCode.get(row.itemCode);
    if (!expected || row.financialGroupCode === expected) return [];
    return [
      {
        itemCode: row.itemCode,
        expected,
        actual: row.financialGroupCode,
      },
    ];
  });
  return { importedCodesFound: rows.length, groupMismatches };
}

export async function applyFinancialGroupImportPlan(
  client: Client | PoolClient,
  updates: PlannedFinancialGroupUpdate[]
) {
  await client.query("BEGIN");
  try {
    const updated = await updateFinancialGroups(client, updates);
    if (updated !== updates.length) {
      throw new Error(
        `Se esperaban ${updates.length} updates y PostgreSQL reporto ${updated}`
      );
    }
    const verification = await verifyImport(client, updates);
    if (
      verification.importedCodesFound !== updates.length ||
      verification.groupMismatches.length > 0
    ) {
      throw new Error("La verificacion transaccional encontro diferencias");
    }
    await client.query("COMMIT");
    return { updated, verification };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function buildReport(params: {
  mode: ImportMode;
  file: string;
  parseResult: FinancialGroupParseResult;
  plan: FinancialGroupImportPlan;
  backupPath: string | null;
  snapshotPath: string | null;
  applyResult?: { updated: number };
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
      missingFinancialGroups: params.plan.missingFinancialGroups.length,
      inactiveFinancialGroups: params.plan.inactiveFinancialGroups.length,
      updates: params.plan.updates.length,
      unchanged: params.plan.unchanged.length,
    },
    applyResult: params.applyResult,
    verification: params.verification,
    skippedRows: params.parseResult.skippedRows,
    duplicateGroups: params.parseResult.duplicateGroups,
    conflictingDuplicateGroups: params.parseResult.conflictingDuplicateGroups,
    missingCatalogCodes: params.plan.missingCatalogCodes,
    missingFinancialGroups: params.plan.missingFinancialGroups,
    inactiveFinancialGroups: params.plan.inactiveFinancialGroups,
    updatedRows: params.plan.updates,
    unchangedRows: params.plan.unchanged,
    validationErrors: params.plan.validationErrors,
  };
}

async function writeJsonReport(reportPath: string, report: ImportReport) {
  const resolvedPath = resolve(process.cwd(), reportPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function getDefaultReportPath(mode: ImportMode) {
  return `${DEFAULT_REPORT_DIR}/financial-groups-${mode}-${formatTimestamp(new Date())}.json`;
}

function printSummary(report: ImportReport, reportPath: string) {
  console.log(`Modo: ${report.mode}`);
  console.log(`Filas leidas: ${report.summary.rawRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Faltantes en app: ${report.summary.missingCatalogCodes}`);
  console.log(`Grupos invalidos: ${report.summary.missingFinancialGroups}`);
  console.log(`Grupos inactivos: ${report.summary.inactiveFinancialGroups}`);
  console.log(`Actualizar: ${report.summary.updates}`);
  console.log(`Sin cambios: ${report.summary.unchanged}`);
  if (report.applyResult)
    console.log(`Actualizados: ${report.applyResult.updated}`);
  if (report.verification) {
    console.log(`Verificados: ${report.verification.importedCodesFound}`);
    console.log(`Diferencias: ${report.verification.groupMismatches.length}`);
  }
  if (report.backupPath) console.log(`Backup: ${report.backupPath}`);
  if (report.snapshotPath) console.log(`Snapshot: ${report.snapshotPath}`);
  console.log(`Reporte: ${reportPath}`);
}

function printHelp() {
  console.log(`
Uso:
  pnpm exec tsx scripts/import-article-financial-groups.ts --mode dry-run --file <xlsx>
  pnpm exec tsx scripts/import-article-financial-groups.ts --mode apply --file <xlsx> --pg-dump-path <pg_dump.exe>
`);
}

async function loadPlan(
  client: Client | PoolClient,
  parseResult: FinancialGroupParseResult
) {
  const itemCodes = parseResult.groupedRows.map(row => row.itemCode);
  const groupCodes = parseResult.groupedRows.map(row => row.financialGroupCode);
  const [articles, groups] = await Promise.all([
    loadCatalogRows(client, itemCodes),
    loadFinancialGroups(client, groupCodes),
  ]);
  return buildFinancialGroupImportPlan(parseResult, articles, groups);
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    printHelp();
    return;
  }
  const options = parseFinancialGroupImportArgs(args);
  if (!options.file) throw new Error("Debes indicar --file <xlsx>");
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurada");
  }

  const parseResult = loadFinancialGroupWorkbook(
    options.file,
    options.sheetName
  );
  const reportPath = options.reportPath ?? getDefaultReportPath(options.mode);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    let plan = await loadPlan(client, parseResult);
    let backupPath: string | null = null;
    let snapshotPath: string | null = null;
    let applyResult: { updated: number } | undefined;
    let verification: Verification | undefined;

    if (plan.validationErrors.length > 0) {
      const report = buildReport({
        mode: options.mode,
        file: options.file,
        parseResult,
        plan,
        backupPath,
        snapshotPath,
      });
      const resolved = await writeJsonReport(reportPath, report);
      printSummary(report, resolved);
      throw new Error(
        "El archivo tiene errores bloqueantes; no se aplicaron cambios"
      );
    }

    if (options.mode === "apply") {
      const timestamp = new Date();
      backupPath = await createFinancialGroupImportBackup({
        databaseUrl: process.env.DATABASE_URL,
        backupDir: options.backupDir,
        pgDumpPath: options.pgDumpPath,
        timestamp,
      });
      snapshotPath = await createFinancialGroupSnapshot({
        client,
        backupDir: options.backupDir,
        itemCodes: plan.updates.map(row => row.itemCode),
        timestamp,
      });

      plan = await loadPlan(client, parseResult);
      if (plan.validationErrors.length > 0) {
        throw new Error(
          "La validacion posterior al backup fallo; no se aplicaron cambios"
        );
      }
      const applied = await applyFinancialGroupImportPlan(client, plan.updates);
      applyResult = { updated: applied.updated };
      verification = applied.verification;
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
    const resolved = await writeJsonReport(reportPath, report);
    printSummary(report, resolved);
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
