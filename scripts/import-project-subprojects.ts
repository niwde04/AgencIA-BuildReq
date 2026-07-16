import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client, type PoolClient } from "pg";
import XLSX from "xlsx";

const execFileAsync = promisify(execFile);

const DEFAULT_SHEET_NAME = "Supproyectos";
const DEFAULT_BACKUP_DIR = "backups";
const DEFAULT_REPORT_DIR = "reports/subproject-imports";

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

type RawSheetRow = unknown[];

export type ParsedSubprojectRow = {
  rowNumber: number;
  projectCode: string;
  projectLabel: string;
  code: string;
  name: string;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startDateIso: string | null;
  endDateIso: string | null;
};

export type SkippedRow = {
  rowNumber: number;
  reason: string;
  projectLabel: string | null;
  code: string | null;
  name: string | null;
};

export type ValidationError = {
  rowNumber: number;
  message: string;
  projectLabel: string | null;
  code: string | null;
  name: string | null;
};

export type ParseResult = {
  sheetName: string;
  headerRowNumber: number;
  rawRows: number;
  parsedRows: ParsedSubprojectRow[];
  skippedRows: SkippedRow[];
  validationErrors: ValidationError[];
};

export type DbProject = {
  id: number;
  code: string;
  name: string;
};

export type DbSubproject = {
  id: number;
  projectId: number;
  code: string;
  name: string;
  description: string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  isActive: boolean;
};

type PlannedSubprojectPayload = {
  projectId: number;
  projectCode: string;
  code: string;
  name: string;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startDateIso: string | null;
  endDateIso: string | null;
  isActive: boolean;
  sourceRow: number;
};

export type PlannedInsert = PlannedSubprojectPayload;

export type PlannedUpdate = PlannedSubprojectPayload & {
  id: number;
  changedFields: Array<
    "projectId" | "code" | "name" | "description" | "startDate" | "endDate" | "isActive"
  >;
  previous: DbSubproject;
};

export type UnchangedRow = PlannedSubprojectPayload & {
  id: number;
};

export type ExistingNotListed = DbSubproject & {
  projectCode: string;
  projectName: string;
};

export type ImportPlan = {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  unchanged: UnchangedRow[];
  existingNotListed: ExistingNotListed[];
  validationErrors: ValidationError[];
};

export type ImportReport = {
  generatedAt: string;
  mode: ImportMode;
  file: string;
  sheetName: string;
  backupPath: string | null;
  snapshotPath: string | null;
  counts: {
    rawRows: number;
    parsedRows: number;
    skippedRows: number;
    validationErrors: number;
    inserts: number;
    updates: number;
    unchanged: number;
    existingNotListed: number;
  };
  parse: Pick<ParseResult, "headerRowNumber" | "skippedRows" | "validationErrors">;
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  unchanged: UnchangedRow[];
  existingNotListed: ExistingNotListed[];
  appliedRows: Array<{ action: "insert" | "update"; id: number; code: string }>;
};

type DatabaseState = {
  projects: DbProject[];
  subprojects: DbSubproject[];
};

type HeaderIndexes = {
  project: number;
  code: number;
  name: number;
  description: number;
  startDate: number;
  endDate: number;
};

function readValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta valor para ${flag}`);
  }
  return value;
}

export function parseProjectSubprojectsArgs(
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
    .replace(/\s*\*+\s*$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeCellText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function findHeaderIndexes(rows: RawSheetRow[]): {
  headerRowIndex: number;
  indexes: HeaderIndexes;
} {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const project = normalized.indexOf("job o proyecto");
    const code = normalized.indexOf("codigo");
    const name = normalized.indexOf("nombre subproyecto");
    const description = normalized.indexOf(
      "breve descripcion del subproyecto o actividad especifica"
    );
    const startDate = normalized.indexOf("fecha de inicio");
    const endDate = normalized.indexOf("fecha finalizacion");

    if (
      project >= 0 &&
      code >= 0 &&
      name >= 0 &&
      description >= 0 &&
      startDate >= 0 &&
      endDate >= 0
    ) {
      return {
        headerRowIndex: rowIndex,
        indexes: {
          project,
          code,
          name,
          description,
          startDate,
          endDate,
        },
      };
    }
  }

  throw new Error("No se encontraron los encabezados esperados de subproyectos");
}

function extractProjectCode(projectLabel: string) {
  const [projectCode] = projectLabel.split(/\s+/);
  return projectCode?.trim() ?? "";
}

function isBlankRow(row: RawSheetRow) {
  return row.every(value => normalizeCellText(value) === "");
}

function parseDateCell(value: unknown, rowNumber: number, fieldLabel: string) {
  if (value === null || value === undefined || normalizeCellText(value) === "") {
    return { date: null as Date | null, iso: null as string | null };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${fieldLabel} invalida en fila ${rowNumber}`);
    }
    return {
      date: new Date(value.getFullYear(), value.getMonth(), value.getDate()),
      iso: toIsoDate(value),
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) {
      throw new Error(`${fieldLabel} invalida en fila ${rowNumber}`);
    }
    const date = new Date(parsed.y, parsed.m - 1, parsed.d);
    return { date, iso: toIsoDate(date) };
  }

  const text = normalizeCellText(value);
  const dayMonthYear = text.match(/^(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{4})$/);
  if (dayMonthYear) {
    const [, dayText, monthText, yearText] = dayMonthYear;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error(`${fieldLabel} invalida en fila ${rowNumber}`);
    }
    return { date, iso: toIsoDate(date) };
  }

  const isoYearMonthDay = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoYearMonthDay) {
    const [, yearText, monthText, dayText] = isoYearMonthDay;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error(`${fieldLabel} invalida en fila ${rowNumber}`);
    }
    return { date, iso: toIsoDate(date) };
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldLabel} invalida en fila ${rowNumber}`);
  }

  return {
    date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    iso: toIsoDate(date),
  };
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function parseSubprojectSheetRows(
  rows: RawSheetRow[],
  sheetName = DEFAULT_SHEET_NAME
): ParseResult {
  const { headerRowIndex, indexes } = findHeaderIndexes(rows);
  const parsedRows: ParsedSubprojectRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const validationErrors: ValidationError[] = [];
  const seenKeys = new Map<string, number>();

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;

    if (isBlankRow(row)) {
      skippedRows.push({
        rowNumber,
        reason: "Fila vacia",
        projectLabel: null,
        code: null,
        name: null,
      });
      continue;
    }

    const projectLabel = normalizeCellText(row[indexes.project]);
    const code = normalizeCellText(row[indexes.code]);
    const name = normalizeCellText(row[indexes.name]);
    const description = normalizeCellText(row[indexes.description]) || null;

    if (projectLabel.toLowerCase() === "total") {
      skippedRows.push({
        rowNumber,
        reason: "Fila de total",
        projectLabel,
        code: code || null,
        name: name || null,
      });
      continue;
    }

    if (!projectLabel && !code && !name) {
      skippedRows.push({
        rowNumber,
        reason: "Fila visual sin datos",
        projectLabel: null,
        code: null,
        name: null,
      });
      continue;
    }

    if (!projectLabel || !code || !name) {
      validationErrors.push({
        rowNumber,
        message: "Proyecto, codigo y nombre son obligatorios",
        projectLabel: projectLabel || null,
        code: code || null,
        name: name || null,
      });
      continue;
    }

    const projectCode = extractProjectCode(projectLabel);
    if (!projectCode) {
      validationErrors.push({
        rowNumber,
        message: "No se pudo resolver el codigo de proyecto",
        projectLabel,
        code,
        name,
      });
      continue;
    }

    let startDate: ReturnType<typeof parseDateCell>;
    let endDate: ReturnType<typeof parseDateCell>;
    try {
      startDate = parseDateCell(row[indexes.startDate], rowNumber, "Fecha de inicio");
      endDate = parseDateCell(row[indexes.endDate], rowNumber, "Fecha de finalizacion");
    } catch (error) {
      validationErrors.push({
        rowNumber,
        message: error instanceof Error ? error.message : String(error),
        projectLabel,
        code,
        name,
      });
      continue;
    }

    if (
      startDate.date &&
      endDate.date &&
      endDate.date.getTime() < startDate.date.getTime()
    ) {
      validationErrors.push({
        rowNumber,
        message: "La fecha de fin no puede ser anterior a la fecha de inicio",
        projectLabel,
        code,
        name,
      });
      continue;
    }

    const duplicateKey = `${projectCode}|${code}`;
    const firstRow = seenKeys.get(duplicateKey);
    if (firstRow) {
      validationErrors.push({
        rowNumber,
        message: `Codigo duplicado en la plantilla; primera aparicion en fila ${firstRow}`,
        projectLabel,
        code,
        name,
      });
      continue;
    }
    seenKeys.set(duplicateKey, rowNumber);

    parsedRows.push({
      rowNumber,
      projectCode,
      projectLabel,
      code,
      name,
      description,
      startDate: startDate.date,
      endDate: endDate.date,
      startDateIso: startDate.iso,
      endDateIso: endDate.iso,
    });
  }

  return {
    sheetName,
    headerRowNumber: headerRowIndex + 1,
    rawRows: rows.length,
    parsedRows,
    skippedRows,
    validationErrors,
  };
}

export function loadSubprojectWorkbook(filePath: string, sheetName: string) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(
      `No existe la hoja ${sheetName}. Hojas disponibles: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rows = XLSX.utils.sheet_to_json<RawSheetRow>(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  });

  return parseSubprojectSheetRows(rows, sheetName);
}

function normalizeDbDate(value: Date | string | null | undefined) {
  return toIsoDate(value);
}

function buildPayload(row: ParsedSubprojectRow, project: DbProject): PlannedSubprojectPayload {
  return {
    projectId: project.id,
    projectCode: project.code,
    code: row.code,
    name: row.name,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    startDateIso: row.startDateIso,
    endDateIso: row.endDateIso,
    isActive: true,
    sourceRow: row.rowNumber,
  };
}

function getChangedFields(existing: DbSubproject, payload: PlannedSubprojectPayload) {
  const changedFields: PlannedUpdate["changedFields"] = [];
  if (existing.projectId !== payload.projectId) changedFields.push("projectId");
  if (existing.code !== payload.code) changedFields.push("code");
  if (existing.name !== payload.name) changedFields.push("name");
  if ((existing.description ?? null) !== payload.description) {
    changedFields.push("description");
  }
  if (normalizeDbDate(existing.startDate) !== payload.startDateIso) {
    changedFields.push("startDate");
  }
  if (normalizeDbDate(existing.endDate) !== payload.endDateIso) {
    changedFields.push("endDate");
  }
  if (existing.isActive !== payload.isActive) changedFields.push("isActive");
  return changedFields;
}

export function buildProjectSubprojectImportPlan(
  parseResult: ParseResult,
  databaseState: DatabaseState
): ImportPlan {
  const projectByCode = new Map(
    databaseState.projects.map(project => [project.code, project])
  );
  const subprojectByProjectAndCode = new Map(
    databaseState.subprojects.map(subproject => [
      `${subproject.projectId}|${subproject.code}`,
      subproject,
    ])
  );
  const projectById = new Map(databaseState.projects.map(project => [project.id, project]));
  const touchedProjectIds = new Set<number>();
  const listedKeys = new Set<string>();

  const inserts: PlannedInsert[] = [];
  const updates: PlannedUpdate[] = [];
  const unchanged: UnchangedRow[] = [];
  const validationErrors = [...parseResult.validationErrors];

  for (const row of parseResult.parsedRows) {
    const project = projectByCode.get(row.projectCode);
    if (!project) {
      validationErrors.push({
        rowNumber: row.rowNumber,
        message: `Proyecto no encontrado para codigo ${row.projectCode}`,
        projectLabel: row.projectLabel,
        code: row.code,
        name: row.name,
      });
      continue;
    }

    touchedProjectIds.add(project.id);
    const payload = buildPayload(row, project);
    const key = `${project.id}|${row.code}`;
    listedKeys.add(key);
    const existing = subprojectByProjectAndCode.get(key);

    if (!existing) {
      inserts.push(payload);
      continue;
    }

    const changedFields = getChangedFields(existing, payload);
    if (changedFields.length === 0) {
      unchanged.push({ ...payload, id: existing.id });
      continue;
    }

    updates.push({
      ...payload,
      id: existing.id,
      changedFields,
      previous: existing,
    });
  }

  const existingNotListed = databaseState.subprojects
    .filter(subproject => {
      if (!touchedProjectIds.has(subproject.projectId)) return false;
      return !listedKeys.has(`${subproject.projectId}|${subproject.code}`);
    })
    .map(subproject => {
      const project = projectById.get(subproject.projectId);
      return {
        ...subproject,
        projectCode: project?.code ?? String(subproject.projectId),
        projectName: project?.name ?? "Proyecto no encontrado",
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));

  return {
    inserts,
    updates,
    unchanged,
    existingNotListed,
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

export async function createSubprojectsImportBackup(params: {
  databaseUrl: string;
  backupDir: string;
  pgDumpPath: string;
  timestamp?: Date;
}) {
  const resolvedBackupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });
  const backupPath = resolve(
    resolvedBackupDir,
    `buildreq-before-subprojects-import-${formatTimestamp(params.timestamp ?? new Date())}.sql`
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
      { maxBuffer: 20 * 1024 * 1024 }
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

async function loadDatabaseState(client: Client | PoolClient): Promise<DatabaseState> {
  const [projectsResult, subprojectsResult] = await Promise.all([
    client.query<DbProject>(
      'SELECT id, code, name FROM projects ORDER BY code'
    ),
    client.query<DbSubproject>(
      'SELECT id, "projectId", code, name, description, "startDate", "endDate", "isActive" FROM "projectSubprojects" ORDER BY "projectId", code, name'
    ),
  ]);

  return {
    projects: projectsResult.rows,
    subprojects: subprojectsResult.rows,
  };
}

export async function createSubprojectsSnapshotBackup(params: {
  client: Client | PoolClient;
  backupDir: string;
  timestamp?: Date;
}) {
  const resolvedBackupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });
  const snapshotPath = resolve(
    resolvedBackupDir,
    `buildreq-before-subprojects-import-${formatTimestamp(params.timestamp ?? new Date())}.snapshot.json`
  );
  const state = await loadDatabaseState(params.client);
  await writeFile(
    snapshotPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tables: ["projects", "projectSubprojects"],
        projects: state.projects,
        projectSubprojects: state.subprojects,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return snapshotPath;
}

async function applyImportPlan(client: Client | PoolClient, plan: ImportPlan) {
  const appliedRows: ImportReport["appliedRows"] = [];

  for (const update of plan.updates) {
    const result = await client.query<{ id: number; code: string }>(
      `UPDATE "projectSubprojects"
       SET "projectId" = $1,
           code = $2,
           name = $3,
           description = $4,
           "startDate" = $5,
           "endDate" = $6,
           "isActive" = $7,
           "updatedAt" = now()
       WHERE id = $8
       RETURNING id, code`,
      [
        update.projectId,
        update.code,
        update.name,
        update.description,
        update.startDate,
        update.endDate,
        update.isActive,
        update.id,
      ]
    );
    const row = result.rows[0];
    if (row) {
      appliedRows.push({ action: "update", id: row.id, code: row.code });
    }
  }

  for (const insert of plan.inserts) {
    const result = await client.query<{ id: number; code: string }>(
      `INSERT INTO "projectSubprojects"
         ("projectId", code, name, description, "startDate", "endDate", "isActive")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, code`,
      [
        insert.projectId,
        insert.code,
        insert.name,
        insert.description,
        insert.startDate,
        insert.endDate,
        insert.isActive,
      ]
    );
    const row = result.rows[0];
    if (row) {
      appliedRows.push({ action: "insert", id: row.id, code: row.code });
    }
  }

  return appliedRows;
}

function buildReport(params: {
  mode: ImportMode;
  file: string;
  parseResult: ParseResult;
  plan: ImportPlan;
  backupPath: string | null;
  snapshotPath: string | null;
  appliedRows?: ImportReport["appliedRows"];
}): ImportReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    file: params.file,
    sheetName: params.parseResult.sheetName,
    backupPath: params.backupPath,
    snapshotPath: params.snapshotPath,
    counts: {
      rawRows: params.parseResult.rawRows,
      parsedRows: params.parseResult.parsedRows.length,
      skippedRows: params.parseResult.skippedRows.length,
      validationErrors: params.plan.validationErrors.length,
      inserts: params.plan.inserts.length,
      updates: params.plan.updates.length,
      unchanged: params.plan.unchanged.length,
      existingNotListed: params.plan.existingNotListed.length,
    },
    parse: {
      headerRowNumber: params.parseResult.headerRowNumber,
      skippedRows: params.parseResult.skippedRows,
      validationErrors: params.plan.validationErrors,
    },
    inserts: params.plan.inserts,
    updates: params.plan.updates,
    unchanged: params.plan.unchanged,
    existingNotListed: params.plan.existingNotListed,
    appliedRows: params.appliedRows ?? [],
  };
}

async function writeJsonReport(reportPath: string, report: ImportReport) {
  const resolvedPath = resolve(process.cwd(), reportPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function getDefaultReportPath(mode: ImportMode) {
  return `${DEFAULT_REPORT_DIR}/project-subprojects-${mode}-${formatTimestamp(new Date())}.json`;
}

function printHelp() {
  console.log(`
Uso:
  pnpm exec tsx scripts/import-project-subprojects.ts --mode dry-run --file "<plantilla.xlsx>"
  pnpm exec tsx scripts/import-project-subprojects.ts --mode apply --file "<plantilla.xlsx>" --pg-dump-path "<ruta pg_dump>"

Opciones:
  --mode dry-run|apply       Modo de ejecucion. Default: dry-run.
  --file <xlsx>              Archivo Excel de subproyectos.
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
  console.log(`Filas validas: ${report.counts.parsedRows}`);
  console.log(`Insertar: ${report.counts.inserts}`);
  console.log(`Actualizar: ${report.counts.updates}`);
  console.log(`Sin cambios: ${report.counts.unchanged}`);
  console.log(`No listados: ${report.counts.existingNotListed}`);
  console.log(`Errores: ${report.counts.validationErrors}`);
  if (report.backupPath) console.log(`Backup: ${report.backupPath}`);
  if (report.snapshotPath) console.log(`Snapshot: ${report.snapshotPath}`);
  console.log(`Reporte: ${reportPath}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseProjectSubprojectsArgs(args);

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

  const parseResult = loadSubprojectWorkbook(options.file, options.sheetName);
  const reportPath = options.reportPath ?? getDefaultReportPath(options.mode);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    let backupPath: string | null = null;
    let snapshotPath: string | null = null;
    let appliedRows: ImportReport["appliedRows"] = [];
    let state = await loadDatabaseState(client);
    let plan = buildProjectSubprojectImportPlan(parseResult, state);

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
      backupPath = await createSubprojectsImportBackup({
        databaseUrl: process.env.DATABASE_URL,
        backupDir: options.backupDir,
        pgDumpPath: options.pgDumpPath,
        timestamp,
      });
      console.log(`Backup creado: ${backupPath}`);
      console.log("Creando snapshot JSON de projects y projectSubprojects...");
      snapshotPath = await createSubprojectsSnapshotBackup({
        client,
        backupDir: options.backupDir,
        timestamp,
      });
      console.log(`Snapshot creado: ${snapshotPath}`);

      await client.query("BEGIN");
      try {
        state = await loadDatabaseState(client);
        plan = buildProjectSubprojectImportPlan(parseResult, state);
        if (plan.validationErrors.length > 0) {
          throw new Error("La plantilla tiene errores de validacion; no se aplicaron cambios");
        }
        appliedRows = await applyImportPlan(client, plan);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const report = buildReport({
      mode: options.mode,
      file: options.file,
      parseResult,
      plan,
      backupPath,
      snapshotPath,
      appliedRows,
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
