import "dotenv/config";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client, type PoolClient } from "pg";
import XLSX from "xlsx";

const execFileAsync = promisify(execFile);
const DEFAULT_SHEET_NAME = "Articulo a Actualizar";
const SERVICES_SHEET_NAME = "Articulos de servicios 06jul";
const DEFAULT_BACKUP_DIR = "backups";
const DEFAULT_REPORT_DIR = "reports/financial-group-imports";
const BATCH_SIZE = 500;

type ImportMode = "dry-run" | "apply";
export type ImportProfile = "legacy" | "services";

type CliOptions = {
  mode: ImportMode;
  file: string | null;
  sheetName: string;
  profile: ImportProfile;
  createMissingGroups: boolean;
  reportPath: string | null;
  backupDir: string;
  pgDumpPath: string;
};

export type ParsedFinancialGroupRow = {
  rowNumber: number;
  itemCode: string;
  financialGroupCode: string;
};

export type ParsedFinancialGroupDefinition = {
  financialGroupCode: string;
  financialGroupDescription: string;
  codN2: string;
  nivel2: string;
  isActive: true;
  sourceRows: number[];
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
  profile: ImportProfile;
  sheetName: string;
  headerRowNumber: number;
  rawRows: number;
  parsedRows: ParsedFinancialGroupRow[];
  skippedRows: SkippedRow[];
  groupedRows: GroupedFinancialGroupRow[];
  duplicateGroups: DuplicateGroup[];
  conflictingDuplicateGroups: DuplicateGroup[];
  financialGroupDefinitions: ParsedFinancialGroupDefinition[];
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
  codN2: string;
  nivel2: string;
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

export type FinancialGroupImportPlan = {
  updates: PlannedFinancialGroupUpdate[];
  unchanged: UnchangedFinancialGroup[];
  missingCatalogCodes: GroupedFinancialGroupRow[];
  missingFinancialGroups: string[];
  inactiveFinancialGroups: string[];
  groupsToCreate: ParsedFinancialGroupDefinition[];
  reusedFinancialGroups: ExistingFinancialGroup[];
  validationErrors: string[];
};

type BuildPlanOptions = {
  createMissingGroups?: boolean;
  requireAllArticles?: boolean;
};

type VerificationMismatch = {
  itemCode: string;
  expected: string;
  actual: string | null;
};

type Verification = {
  importedCodesFound: number;
  groupMismatches: VerificationMismatch[];
  requestedFinancialGroupsFound: number;
  inactiveFinancialGroups: string[];
  createdGroupDefinitionMismatches: Array<{
    financialGroupCode: string;
    expected: Pick<
      ParsedFinancialGroupDefinition,
      "financialGroupDescription" | "codN2" | "nivel2" | "isActive"
    >;
    actual: ExistingFinancialGroup | null;
  }>;
};

type BackupArtifact = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

type ImportReport = {
  generatedAt: string;
  mode: ImportMode;
  file: string;
  profile: ImportProfile;
  sheetName: string;
  sourceSha256: string;
  backupPath: string | null;
  backupSha256: string | null;
  backupSizeBytes: number | null;
  snapshotPath: string | null;
  summary: {
    rawRows: number;
    parsedRows: number;
    uniqueCodes: number;
    skippedRows: number;
    duplicateCodes: number;
    conflictingDuplicateCodes: number;
    requestedFinancialGroups: number;
    financialGroupsToCreate: number;
    reusedFinancialGroups: number;
    missingCatalogCodes: number;
    missingFinancialGroups: number;
    inactiveFinancialGroups: number;
    updates: number;
    unchanged: number;
  };
  applyResult?: { updated: number; insertedFinancialGroups: number };
  verification?: Verification;
  skippedRows: SkippedRow[];
  duplicateGroups: DuplicateGroup[];
  conflictingDuplicateGroups: DuplicateGroup[];
  missingCatalogCodes: GroupedFinancialGroupRow[];
  missingFinancialGroups: string[];
  inactiveFinancialGroups: string[];
  groupsToCreate: ParsedFinancialGroupDefinition[];
  reusedFinancialGroups: ExistingFinancialGroup[];
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
  let sheetName: string | null = null;
  let profile: ImportProfile = "legacy";
  let createMissingGroups = false;
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
    } else if (arg === "--profile") {
      const value = readValue(args, index, arg);
      if (value !== "legacy" && value !== "services") {
        throw new Error("--profile debe ser legacy o services");
      }
      profile = value;
      index += 1;
    } else if (arg === "--create-missing-groups") {
      createMissingGroups = true;
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

  return {
    mode,
    file,
    sheetName:
      sheetName ??
      (profile === "services" ? SERVICES_SHEET_NAME : DEFAULT_SHEET_NAME),
    profile,
    createMissingGroups,
    reportPath,
    backupDir,
    pgDumpPath,
  };
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

function groupFinancialGroupRows(
  parsedRows: ParsedFinancialGroupRow[],
  validationErrors: string[]
) {
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
        `Codigo ${itemCode}: aparece con mas de un grupo financiero en filas ${duplicate.sourceRows.join(", ")}`
      );
    }
  }

  return {
    groupedRows: groupedRows.sort((a, b) =>
      a.itemCode.localeCompare(b.itemCode)
    ),
    duplicateGroups,
    conflictingDuplicateGroups,
  };
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

  const { groupedRows, duplicateGroups, conflictingDuplicateGroups } =
    groupFinancialGroupRows(parsedRows, validationErrors);

  return {
    profile: "legacy",
    sheetName,
    headerRowNumber: 2,
    rawRows: Math.max(rows.length - 2, 0),
    parsedRows,
    skippedRows,
    groupedRows,
    duplicateGroups,
    conflictingDuplicateGroups,
    financialGroupDefinitions: [],
    validationErrors,
  };
}

export function parseServiceFinancialGroupSheetRows(
  rows: unknown[][],
  sheetName = SERVICES_SHEET_NAME
): FinancialGroupParseResult {
  if (rows.length < 3) {
    throw new Error("La hoja no contiene la fila 3 de encabezados esperada");
  }

  const headers = rows[2] ?? [];
  const headerIndex = new Map(
    headers.map((header, index) => [normalizeHeader(header), index])
  );
  const itemCodeIndex = headerIndex.get(normalizeHeader("Código Articulo"));
  const nivel4CodeIndex = headerIndex.get(normalizeHeader("NIVEL4"));
  const financialGroupCodeIndex = headerIndex.get(
    normalizeHeader("grupo financiero")
  );
  const codN2Index = headerIndex.get(normalizeHeader("NIVEL2"));
  const nivel2Index = headerIndex.get(normalizeHeader("NIVEL 2"));
  const nivel4DescriptionIndex = headerIndex.get(normalizeHeader("NIVEL 4"));
  const fullDescriptionIndex = headerIndex.get(
    normalizeHeader("descripcion grupo financiero")
  );
  const missingHeaders = [
    itemCodeIndex === undefined ? "Código Articulo" : null,
    nivel4CodeIndex === undefined ? "NIVEL4" : null,
    financialGroupCodeIndex === undefined ? "grupo financiero" : null,
    codN2Index === undefined ? "NIVEL2" : null,
    nivel2Index === undefined ? "NIVEL 2" : null,
    nivel4DescriptionIndex === undefined ? "NIVEL 4" : null,
    fullDescriptionIndex === undefined ? "descripcion grupo financiero" : null,
  ].filter(Boolean);
  if (missingHeaders.length > 0) {
    throw new Error(
      `Faltan encabezados requeridos: ${missingHeaders.join(", ")}`
    );
  }

  const parsedRows: ParsedFinancialGroupRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const validationErrors: string[] = [];
  const definitionsByCode = new Map<string, ParsedFinancialGroupDefinition>();

  for (let index = 3; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    const itemCode = normalizeCell(row[itemCodeIndex!]);
    const nivel4Code = normalizeCell(row[nivel4CodeIndex!]);
    const financialGroupCode = normalizeCell(row[financialGroupCodeIndex!]);
    const codN2 = normalizeCell(row[codN2Index!]);
    const nivel2 = normalizeCell(row[nivel2Index!]);
    const nivel4Description = normalizeCell(row[nivel4DescriptionIndex!]);
    const fullDescription = normalizeCell(row[fullDescriptionIndex!]);

    if (
      !itemCode &&
      !nivel4Code &&
      !financialGroupCode &&
      !codN2 &&
      !nivel2 &&
      !nivel4Description &&
      !fullDescription
    ) {
      skippedRows.push({
        rowNumber,
        reason: "Fila vacia",
        itemCode: null,
        financialGroupCode: null,
      });
      continue;
    }

    const rowErrors: string[] = [];
    if (!itemCode) rowErrors.push("Código Articulo es obligatorio");
    if (itemCode.length > 50)
      rowErrors.push("Código Articulo excede 50 caracteres");
    if (!/^\d{8}$/.test(financialGroupCode))
      rowErrors.push("grupo financiero debe contener 8 digitos");
    if (nivel4Code !== financialGroupCode)
      rowErrors.push("NIVEL4 no coincide con grupo financiero");
    if (!codN2 || codN2.length > 20)
      rowErrors.push("NIVEL2 debe contener un código de hasta 20 caracteres");
    if (!nivel2 || nivel2.length > 255)
      rowErrors.push("NIVEL 2 debe contener una descripción válida");
    if (!nivel4Description)
      rowErrors.push("NIVEL 4 debe contener una descripción");

    const financialGroupDescription = `${financialGroupCode}-${nivel2}-${nivel4Description}`;
    if (financialGroupDescription.length > 500)
      rowErrors.push(
        "la descripción del grupo financiero excede 500 caracteres"
      );
    if (
      !fullDescription.startsWith(`${financialGroupCode}-`) ||
      !fullDescription.endsWith(`-${nivel2}-${nivel4Description}`)
    ) {
      rowErrors.push(
        "descripcion grupo financiero no coincide con el código y niveles indicados"
      );
    }

    if (rowErrors.length > 0) {
      const messages = rowErrors.map(error => `Fila ${rowNumber}: ${error}`);
      validationErrors.push(...messages);
      skippedRows.push({
        rowNumber,
        reason: messages.join("; "),
        itemCode: itemCode || null,
        financialGroupCode: financialGroupCode || null,
      });
      continue;
    }

    parsedRows.push({ rowNumber, itemCode, financialGroupCode });
    const existingDefinition = definitionsByCode.get(financialGroupCode);
    const candidate = {
      financialGroupCode,
      financialGroupDescription,
      codN2,
      nivel2,
      isActive: true as const,
      sourceRows: [rowNumber],
    };
    if (!existingDefinition) {
      definitionsByCode.set(financialGroupCode, candidate);
    } else if (
      existingDefinition.financialGroupDescription !==
        candidate.financialGroupDescription ||
      existingDefinition.codN2 !== candidate.codN2 ||
      existingDefinition.nivel2 !== candidate.nivel2
    ) {
      validationErrors.push(
        `Grupo ${financialGroupCode}: tiene metadatos conflictivos en las filas ${[
          ...existingDefinition.sourceRows,
          rowNumber,
        ].join(", ")}`
      );
    } else {
      existingDefinition.sourceRows.push(rowNumber);
    }
  }

  const { groupedRows, duplicateGroups, conflictingDuplicateGroups } =
    groupFinancialGroupRows(parsedRows, validationErrors);

  return {
    profile: "services",
    sheetName,
    headerRowNumber: 3,
    rawRows: Math.max(rows.length - 3, 0),
    parsedRows,
    skippedRows,
    groupedRows,
    duplicateGroups,
    conflictingDuplicateGroups,
    financialGroupDefinitions: Array.from(definitionsByCode.values()).sort(
      (a, b) => a.financialGroupCode.localeCompare(b.financialGroupCode)
    ),
    validationErrors,
  };
}

export function loadFinancialGroupWorkbook(
  filePath: string,
  sheetName: string,
  profile: ImportProfile = "legacy"
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
  return profile === "services"
    ? parseServiceFinancialGroupSheetRows(rows, sheetName)
    : parseFinancialGroupSheetRows(rows, sheetName);
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
  itemCodes: string[],
  options?: { forUpdate?: boolean }
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
        order by "itemCode"
        ${options?.forUpdate ? "for update" : ""}`,
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
    `select "financialGroupCode",
            "financialGroupDescription",
            "codN2",
            "nivel2",
            "isActive"
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
  existingGroups: ExistingFinancialGroup[],
  options: BuildPlanOptions = {}
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
  const definitionsByCode = new Map(
    parseResult.financialGroupDefinitions.map(definition => [
      definition.financialGroupCode,
      definition,
    ])
  );
  const groupsToCreate = options.createMissingGroups
    ? missingFinancialGroups.flatMap(code => {
        const definition = definitionsByCode.get(code);
        return definition ? [definition] : [];
      })
    : [];
  const creatableCodes = new Set(
    groupsToCreate.map(group => group.financialGroupCode)
  );
  const invalidGroupCodes = new Set([
    ...missingFinancialGroups.filter(code => !creatableCodes.has(code)),
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
  if (missingFinancialGroups.length > 0 && !options.createMissingGroups) {
    validationErrors.push(
      `Hay ${missingFinancialGroups.length} grupos financieros inexistentes`
    );
  }
  const missingDefinitions = missingFinancialGroups.filter(
    code => !definitionsByCode.has(code)
  );
  if (options.createMissingGroups && missingDefinitions.length > 0) {
    validationErrors.push(
      `No hay metadatos para crear los grupos financieros: ${missingDefinitions.join(", ")}`
    );
  }
  if (inactiveFinancialGroups.length > 0) {
    validationErrors.push(
      `Hay ${inactiveFinancialGroups.length} grupos financieros inactivos`
    );
  }
  if (options.requireAllArticles && missingCatalogCodes.length > 0) {
    validationErrors.push(
      `Hay ${missingCatalogCodes.length} artículos inexistentes en sapCatalog`
    );
  }

  return {
    updates,
    unchanged,
    missingCatalogCodes,
    missingFinancialGroups,
    inactiveFinancialGroups,
    groupsToCreate,
    reusedFinancialGroups: existingGroups.filter(group =>
      requestedGroupCodes.includes(group.financialGroupCode)
    ),
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

export async function calculateFileSha256(filePath: string) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex").toUpperCase();
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
  const backupStats = await stat(backupPath);
  if (!backupStats.isFile() || backupStats.size <= 0) {
    throw new Error("El backup obligatorio se genero vacio o no es un archivo");
  }
  return {
    path: backupPath,
    sha256: await calculateFileSha256(backupPath),
    sizeBytes: backupStats.size,
  } satisfies BackupArtifact;
}

export async function createFinancialGroupSnapshot(params: {
  client: Client | PoolClient;
  backupDir: string;
  itemCodes: string[];
  financialGroupCodes: string[];
  sourceFile: string;
  sourceSha256: string;
  groupsToCreate: ParsedFinancialGroupDefinition[];
  plannedUpdates: PlannedFinancialGroupUpdate[];
  timestamp?: Date;
}) {
  const backupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(backupDir, { recursive: true });
  const snapshotPath = resolve(
    backupDir,
    `buildreq-before-financial-groups-import-${formatTimestamp(params.timestamp ?? new Date())}.snapshot.json`
  );
  const [articleRows, existingGroups] = await Promise.all([
    loadCatalogRows(params.client, params.itemCodes),
    loadFinancialGroups(params.client, params.financialGroupCodes),
  ]);
  const existingGroupsByCode = new Map(
    existingGroups.map(group => [group.financialGroupCode, group])
  );
  await writeFile(
    snapshotPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceFile: resolve(params.sourceFile),
        sourceSha256: params.sourceSha256,
        articles: {
          table: "sapCatalog",
          rowCount: articleRows.length,
          rows: articleRows,
        },
        financialGroups: {
          table: "financialGroups",
          requestedCount: params.financialGroupCodes.length,
          states: params.financialGroupCodes.map(financialGroupCode => ({
            financialGroupCode,
            existed: existingGroupsByCode.has(financialGroupCode),
            row: existingGroupsByCode.get(financialGroupCode) ?? null,
          })),
        },
        plannedGroupsToCreate: params.groupsToCreate,
        plannedArticleUpdates: params.plannedUpdates.map(update => ({
          itemCode: update.itemCode,
          previousFinancialGroupCode: update.previous.financialGroupCode,
          targetFinancialGroupCode: update.financialGroupCode,
          sourceRows: update.sourceRows,
        })),
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

async function insertMissingFinancialGroups(
  client: Client | PoolClient,
  groups: ParsedFinancialGroupDefinition[]
) {
  let inserted = 0;
  for (const chunk of chunkItems(groups)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `insert into "financialGroups" (
         "financialGroupCode",
         "financialGroupDescription",
         "codN2",
         "nivel2",
         "isActive"
       )
       select x."financialGroupCode",
              x."financialGroupDescription",
              x."codN2",
              x."nivel2",
              x."isActive"
         from jsonb_to_recordset($1::jsonb) as x(
           "financialGroupCode" text,
           "financialGroupDescription" text,
           "codN2" text,
           "nivel2" text,
           "isActive" boolean
         )
       on conflict ("financialGroupCode") do nothing`,
      [
        JSON.stringify(
          chunk.map(group => ({
            financialGroupCode: group.financialGroupCode,
            financialGroupDescription: group.financialGroupDescription,
            codN2: group.codN2,
            nivel2: group.nivel2,
            isActive: group.isActive,
          }))
        ),
      ]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function verifyArticleUpdates(
  client: Client | PoolClient,
  updates: PlannedFinancialGroupUpdate[]
) {
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

async function verifyRequiredFinancialGroups(
  client: Client | PoolClient,
  requestedFinancialGroupCodes: string[],
  groupsToCreate: ParsedFinancialGroupDefinition[]
) {
  const uniqueCodes = Array.from(new Set(requestedFinancialGroupCodes));
  const groups = await loadFinancialGroups(client, uniqueCodes);
  const groupsByCode = new Map(
    groups.map(group => [group.financialGroupCode, group])
  );
  const inactiveFinancialGroups = groups
    .filter(group => !group.isActive)
    .map(group => group.financialGroupCode);
  const createdGroupDefinitionMismatches = groupsToCreate.flatMap(expected => {
    const actual = groupsByCode.get(expected.financialGroupCode) ?? null;
    if (
      actual &&
      actual.financialGroupDescription === expected.financialGroupDescription &&
      actual.codN2 === expected.codN2 &&
      actual.nivel2 === expected.nivel2 &&
      actual.isActive === expected.isActive
    ) {
      return [];
    }
    return [
      {
        financialGroupCode: expected.financialGroupCode,
        expected: {
          financialGroupDescription: expected.financialGroupDescription,
          codN2: expected.codN2,
          nivel2: expected.nivel2,
          isActive: expected.isActive,
        },
        actual,
      },
    ];
  });
  return {
    requestedFinancialGroupsFound: groups.length,
    inactiveFinancialGroups,
    createdGroupDefinitionMismatches,
  };
}

export async function applyFinancialGroupImportPlan(
  client: Client | PoolClient,
  updates: PlannedFinancialGroupUpdate[],
  groupsToCreate: ParsedFinancialGroupDefinition[] = [],
  requestedFinancialGroupCodes: string[] = Array.from(
    new Set(updates.map(update => update.financialGroupCode))
  )
) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const lockedRows = await loadCatalogRows(
      client,
      updates.map(update => update.itemCode),
      { forUpdate: true }
    );
    if (lockedRows.length !== updates.length) {
      throw new Error(
        `Se esperaban ${updates.length} artículos bloqueados y PostgreSQL devolvio ${lockedRows.length}`
      );
    }
    const lockedByCode = new Map(lockedRows.map(row => [row.itemCode, row]));
    const driftedRows = updates.filter(
      update =>
        lockedByCode.get(update.itemCode)?.financialGroupCode !==
        update.previous.financialGroupCode
    );
    if (driftedRows.length > 0) {
      throw new Error(
        `La asignacion financiera cambio después del dry-run para: ${driftedRows
          .map(row => row.itemCode)
          .join(", ")}`
      );
    }

    const insertedFinancialGroups = await insertMissingFinancialGroups(
      client,
      groupsToCreate
    );
    const groupVerification = await verifyRequiredFinancialGroups(
      client,
      requestedFinancialGroupCodes,
      groupsToCreate
    );
    if (
      groupVerification.requestedFinancialGroupsFound !==
        new Set(requestedFinancialGroupCodes).size ||
      groupVerification.inactiveFinancialGroups.length > 0 ||
      groupVerification.createdGroupDefinitionMismatches.length > 0
    ) {
      throw new Error(
        "La verificacion transaccional de grupos financieros encontro diferencias"
      );
    }

    const updated = await updateFinancialGroups(client, updates);
    if (updated !== updates.length) {
      throw new Error(
        `Se esperaban ${updates.length} updates y PostgreSQL reporto ${updated}`
      );
    }
    const articleVerification = await verifyArticleUpdates(client, updates);
    const verification: Verification = {
      ...articleVerification,
      ...groupVerification,
    };
    if (
      verification.importedCodesFound !== updates.length ||
      verification.groupMismatches.length > 0
    ) {
      throw new Error("La verificacion transaccional encontro diferencias");
    }
    await client.query("COMMIT");
    return { updated, insertedFinancialGroups, verification };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function buildReport(params: {
  mode: ImportMode;
  file: string;
  sourceSha256: string;
  parseResult: FinancialGroupParseResult;
  plan: FinancialGroupImportPlan;
  backup: BackupArtifact | null;
  snapshotPath: string | null;
  applyResult?: { updated: number; insertedFinancialGroups: number };
  verification?: Verification;
}): ImportReport {
  const requestedFinancialGroups = new Set(
    params.parseResult.groupedRows.map(row => row.financialGroupCode)
  ).size;
  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    file: params.file,
    profile: params.parseResult.profile,
    sheetName: params.parseResult.sheetName,
    sourceSha256: params.sourceSha256,
    backupPath: params.backup?.path ?? null,
    backupSha256: params.backup?.sha256 ?? null,
    backupSizeBytes: params.backup?.sizeBytes ?? null,
    snapshotPath: params.snapshotPath,
    summary: {
      rawRows: params.parseResult.rawRows,
      parsedRows: params.parseResult.parsedRows.length,
      uniqueCodes: params.parseResult.groupedRows.length,
      skippedRows: params.parseResult.skippedRows.length,
      duplicateCodes: params.parseResult.duplicateGroups.length,
      conflictingDuplicateCodes:
        params.parseResult.conflictingDuplicateGroups.length,
      requestedFinancialGroups,
      financialGroupsToCreate: params.plan.groupsToCreate.length,
      reusedFinancialGroups: params.plan.reusedFinancialGroups.length,
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
    groupsToCreate: params.plan.groupsToCreate,
    reusedFinancialGroups: params.plan.reusedFinancialGroups,
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
  console.log(`Perfil: ${report.profile}`);
  console.log(`Filas leidas: ${report.summary.rawRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Faltantes en app: ${report.summary.missingCatalogCodes}`);
  console.log(`Grupos requeridos: ${report.summary.requestedFinancialGroups}`);
  console.log(`Grupos a crear: ${report.summary.financialGroupsToCreate}`);
  console.log(`Grupos reutilizados: ${report.summary.reusedFinancialGroups}`);
  console.log(`Grupos inactivos: ${report.summary.inactiveFinancialGroups}`);
  console.log(`Actualizar: ${report.summary.updates}`);
  console.log(`Sin cambios: ${report.summary.unchanged}`);
  if (report.applyResult) {
    console.log(
      `Grupos insertados: ${report.applyResult.insertedFinancialGroups}`
    );
    console.log(`Actualizados: ${report.applyResult.updated}`);
  }
  if (report.verification) {
    console.log(`Verificados: ${report.verification.importedCodesFound}`);
    console.log(`Diferencias: ${report.verification.groupMismatches.length}`);
    console.log(
      `Grupos verificados: ${report.verification.requestedFinancialGroupsFound}`
    );
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
  pnpm exec tsx scripts/import-article-financial-groups.ts --profile services --create-missing-groups --mode dry-run --file <xlsx>

Opciones nuevas:
  --profile legacy|services      Formato de la hoja; legacy es el valor predeterminado.
  --create-missing-groups        Permite crear grupos faltantes cuando el perfil aporta sus metadatos.
`);
}

async function loadPlan(
  client: Client | PoolClient,
  parseResult: FinancialGroupParseResult,
  options: Pick<CliOptions, "createMissingGroups" | "profile">
) {
  const itemCodes = parseResult.groupedRows.map(row => row.itemCode);
  const groupCodes = parseResult.groupedRows.map(row => row.financialGroupCode);
  const [articles, groups] = await Promise.all([
    loadCatalogRows(client, itemCodes),
    loadFinancialGroups(client, groupCodes),
  ]);
  return buildFinancialGroupImportPlan(parseResult, articles, groups, {
    createMissingGroups: options.createMissingGroups,
    requireAllArticles: options.profile === "services",
  });
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
    options.sheetName,
    options.profile
  );
  const sourceSha256 = await calculateFileSha256(options.file);
  const reportPath = options.reportPath ?? getDefaultReportPath(options.mode);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    let plan = await loadPlan(client, parseResult, options);
    let backup: BackupArtifact | null = null;
    let snapshotPath: string | null = null;
    let applyResult:
      | { updated: number; insertedFinancialGroups: number }
      | undefined;
    let verification: Verification | undefined;

    if (plan.validationErrors.length > 0) {
      const report = buildReport({
        mode: options.mode,
        file: options.file,
        sourceSha256,
        parseResult,
        plan,
        backup,
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
      backup = await createFinancialGroupImportBackup({
        databaseUrl: process.env.DATABASE_URL,
        backupDir: options.backupDir,
        pgDumpPath: options.pgDumpPath,
        timestamp,
      });
      snapshotPath = await createFinancialGroupSnapshot({
        client,
        backupDir: options.backupDir,
        itemCodes: parseResult.groupedRows.map(row => row.itemCode),
        financialGroupCodes: Array.from(
          new Set(parseResult.groupedRows.map(row => row.financialGroupCode))
        ),
        sourceFile: options.file,
        sourceSha256,
        groupsToCreate: plan.groupsToCreate,
        plannedUpdates: plan.updates,
        timestamp,
      });

      const postBackupSourceSha256 = await calculateFileSha256(options.file);
      if (postBackupSourceSha256 !== sourceSha256) {
        throw new Error(
          "El archivo fuente cambió después del dry-run; no se aplicaron cambios"
        );
      }

      plan = await loadPlan(client, parseResult, options);
      if (plan.validationErrors.length > 0) {
        throw new Error(
          "La validacion posterior al backup fallo; no se aplicaron cambios"
        );
      }
      const requestedFinancialGroupCodes = Array.from(
        new Set(parseResult.groupedRows.map(row => row.financialGroupCode))
      );
      const applied = await applyFinancialGroupImportPlan(
        client,
        plan.updates,
        plan.groupsToCreate,
        requestedFinancialGroupCodes
      );
      applyResult = {
        updated: applied.updated,
        insertedFinancialGroups: applied.insertedFinancialGroups,
      };
      verification = applied.verification;
    }

    const report = buildReport({
      mode: options.mode,
      file: options.file,
      sourceSha256,
      parseResult,
      plan,
      backup,
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
