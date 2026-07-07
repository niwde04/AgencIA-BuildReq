import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const DEFAULT_SHEET_NAME = "ARTICULOS";
const LEGACY_SHEET_NAME = "Hoja1";
const BATCH_SIZE = 500;

const REQUIRED_HEADERS = [
  "Codigo Proyecto",
  "Nombre Proyecto",
  "Numero de articulo",
  "Tipo de articulo",
  "Descripcion del articulo",
  "Grupo SAP",
] as const;

const KNOWN_UNMAPPED_HEADERS = [
  "Codigo de almacen",
  "Nombre de almacen",
  "Descripcion del articulo completa",
  "Unidad",
  "Categoria inventario",
  "En stock",
  "Stock minimo",
  "Año",
] as const;

const FIELD_LIMITS = {
  itemCode: 50,
  description: 500,
  itemGroup: 255,
  fixedAssetSerialNumber: 120,
  fixedAssetColor: 120,
  fixedAssetModel: 120,
  fixedAssetBrand: 120,
  fixedAssetChassisSeries: 120,
  fixedAssetMotorSeries: 120,
  fixedAssetPlateOrCode: 120,
} as const;

const ASSET_CONDITION_LABELS = {
  NUEVO: "nuevo",
  "USADO BUEN ESTADO": "usado_buen_estado",
  DEFECTUOSO: "defectuoso",
  DANADO: "danado",
  "DANADO/DANIADO": "danado",
} as const;

type AssetCondition =
  (typeof ASSET_CONDITION_LABELS)[keyof typeof ASSET_CONDITION_LABELS];

type Mode = "dry-run" | "apply";

type CliOptions = {
  mode: Mode;
  file: string;
  report?: string;
  sheetName?: string;
};

type RawExcelRow = Record<string, unknown>;

export type ProjectRef = {
  id: number;
  code: string;
  name: string;
};

export type ExistingAssetRow = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  tipoArticulo: number;
  projectId: number | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
  fixedAssetStatus: string | null;
  fixedAssetSourcePurchaseOrderId: number | null;
  fixedAssetSourcePurchaseOrderItemId: number | null;
  fixedAssetSerialNumber: string | null;
  fixedAssetCondition: string | null;
  fixedAssetColor: string | null;
  fixedAssetModel: string | null;
  fixedAssetBrand: string | null;
  fixedAssetChassisSeries: string | null;
  fixedAssetMotorSeries: string | null;
  fixedAssetPlateOrCode: string | null;
  fixedAssetIsLeasing: boolean;
  fixedAssetObservation: string | null;
};

export type SkippedRow = {
  rowNumber: number;
  reason: string;
  blocking: boolean;
  itemCode: string | null;
  projectCode: string | null;
  tipoArticulo: string | null;
  description: string | null;
};

export type ParsedAssetRow = {
  rowNumber: number;
  itemCode: string;
  description: string;
  itemGroup: string;
  tipoArticulo: "ACTIVO";
  projectCodeRaw: string | null;
  projectKey: string | null;
  projectNameRaw: string | null;
  warehouseCodeRaw: string | null;
  warehouseNameRaw: string | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
  fixedAssetSerialNumber: string | null;
  fixedAssetCondition: AssetCondition | null;
  fixedAssetColor: string | null;
  fixedAssetModel: string | null;
  fixedAssetBrand: string | null;
  fixedAssetChassisSeries: string | null;
  fixedAssetMotorSeries: string | null;
  fixedAssetPlateOrCode: string | null;
  fixedAssetIsLeasing: boolean | null;
  fixedAssetObservation: string | null;
};

export type ResolvedAssetRow = ParsedAssetRow & {
  project: ProjectRef | null;
  projectId: number | null;
};

export type DuplicateCode = {
  itemCode: string;
  sourceRows: number[];
};

export type MissingProject = {
  projectCode: string;
  projectKey: string;
  projectName: string | null;
  rows: number[];
};

type AssetImportField =
  | "description"
  | "itemGroup"
  | "projectId"
  | "allowsTaxWithholding"
  | "tipoArticulo"
  | "isActive"
  | "fixedAssetSerialNumber"
  | "fixedAssetCondition"
  | "fixedAssetColor"
  | "fixedAssetModel"
  | "fixedAssetBrand"
  | "fixedAssetChassisSeries"
  | "fixedAssetMotorSeries"
  | "fixedAssetPlateOrCode"
  | "fixedAssetIsLeasing"
  | "fixedAssetObservation";

export type PlannedUpdate = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string;
  tipoArticulo: 3;
  projectId: number | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
  fixedAssetSerialNumber: string | null;
  fixedAssetCondition: AssetCondition | null;
  fixedAssetColor: string | null;
  fixedAssetModel: string | null;
  fixedAssetBrand: string | null;
  fixedAssetChassisSeries: string | null;
  fixedAssetMotorSeries: string | null;
  fixedAssetPlateOrCode: string | null;
  fixedAssetIsLeasing: boolean;
  fixedAssetObservation: string | null;
  sourceRow: number;
  projectCodeRaw: string | null;
  projectNameRaw: string | null;
  previous: ExistingAssetRow;
  changedFields: AssetImportField[];
  fieldChanges: Record<AssetImportField, boolean>;
};

export type PlannedInsert = {
  itemCode: string;
  description: string;
  itemGroup: string;
  tipoArticulo: 3;
  projectId: number | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
  fixedAssetSerialNumber: string | null;
  fixedAssetCondition: AssetCondition | null;
  fixedAssetColor: string | null;
  fixedAssetModel: string | null;
  fixedAssetBrand: string | null;
  fixedAssetChassisSeries: string | null;
  fixedAssetMotorSeries: string | null;
  fixedAssetPlateOrCode: string | null;
  fixedAssetIsLeasing: boolean;
  fixedAssetObservation: string | null;
  sourceRow: number;
  projectCodeRaw: string | null;
  projectNameRaw: string | null;
};

type AppliedInsert = {
  id: number;
  itemCode: string;
};

export type ImportPlan = {
  updates: PlannedUpdate[];
  inserts: PlannedInsert[];
};

type ProjectSummary = {
  projectId: number | null;
  projectCode: string | null;
  projectName: string | null;
  rows: number;
};

type FieldMismatch = {
  itemCode: string;
  field: AssetImportField;
  expected: unknown;
  actual: unknown;
};

type Verification = {
  importedCodesFound: number;
  importedCodesWithAssetType: number;
  missingImportedCodes: string[];
  nonAssetRows: Array<{ itemCode: string; tipoArticulo: number }>;
  fieldMismatches: FieldMismatch[];
  projectSummary: ProjectSummary[];
};

type ImportReport = {
  generatedAt: string;
  mode: Mode;
  source: {
    file: string;
    sheetName: string;
    availableSheets: string[];
    rawRows: number;
    unmappedColumns: string[];
  };
  summary: {
    rawRows: number;
    parsedRows: number;
    uniqueCodes: number;
    skippedRows: number;
    blockingSkippedRows: number;
    duplicateCodes: number;
    missingProjects: number;
    validationErrors: number;
    existingRows: number;
    updates: number;
    inserts: number;
    fieldChanges: Record<AssetImportField, number>;
  };
  applyResult?: {
    updated: number;
    inserted: number;
  };
  projectSummary: ProjectSummary[];
  skippedRows: SkippedRow[];
  duplicateCodes: DuplicateCode[];
  missingProjects: MissingProject[];
  validationErrors: string[];
  updatedRows: PlannedUpdate[];
  insertedRows: Array<PlannedInsert & { id?: number }>;
  verification?: Verification;
};

type WorkbookReadResult = {
  file: string;
  sheetName: string;
  availableSheets: string[];
  rawRows: RawExcelRow[];
  headers: string[];
  missingHeaders: string[];
  unmappedColumns: string[];
};

type ParsedRowsResult = {
  parsedRows: ParsedAssetRow[];
  skippedRows: SkippedRow[];
  validationErrors: string[];
};

const ASSET_IMPORT_FIELDS: AssetImportField[] = [
  "description",
  "itemGroup",
  "projectId",
  "allowsTaxWithholding",
  "tipoArticulo",
  "isActive",
  "fixedAssetSerialNumber",
  "fixedAssetCondition",
  "fixedAssetColor",
  "fixedAssetModel",
  "fixedAssetBrand",
  "fixedAssetChassisSeries",
  "fixedAssetMotorSeries",
  "fixedAssetPlateOrCode",
  "fixedAssetIsLeasing",
  "fixedAssetObservation",
];

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-fixed-assets-hidalgo.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-fixed-assets-hidalgo.ts --file <xlsx> --apply --report <json>",
      "  Optional: --sheet <sheet-name>",
    ].join("\n")
  );
}

export function parseArgs(argv: string[]): CliOptions {
  let mode: Mode | undefined;
  let file: string | undefined;
  let report: string | undefined;
  let sheetName: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      file = argv[index + 1];
      index += 1;
    } else if (arg === "--report") {
      report = argv[index + 1];
      index += 1;
    } else if (arg === "--sheet") {
      sheetName = argv[index + 1];
      index += 1;
    } else if (arg === "--dry-run") {
      mode = "dry-run";
    } else if (arg === "--apply") {
      mode = "apply";
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  if (argv.includes("--dry-run") && argv.includes("--apply")) {
    throw new Error("Use solo uno: --dry-run o --apply");
  }
  if (!mode) throw new Error("Debe indicar --dry-run o --apply");
  if (!file) throw new Error("Debe indicar --file <xlsx>");
  return { mode, file, report, sheetName };
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value: unknown) {
  return normalizeCell(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeProjectKey(value: unknown) {
  const raw = normalizeCell(value);
  if (!raw) return "";
  const withoutLeadingZeroes = raw.replace(/^0+/, "");
  return withoutLeadingZeroes || "0";
}

function nonEmptyOrNull(value: unknown) {
  const normalized = normalizeCell(value);
  return normalized ? normalized : null;
}

function requireDatabaseUrl() {
  dotenv.config({ path: ".env" });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no esta configurado en .env");
  return connectionString;
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isBlankExcelRow(row: RawExcelRow) {
  return [
    "Codigo Proyecto",
    "Nombre Proyecto",
    "Codigo de almacen",
    "Nombre de almacen",
    "Numero de articulo",
    "Tipo de articulo",
    "Descripcion del articulo",
    "Descripcion del articulo completa",
  ].every(header => normalizeCell(row[header]) === "");
}

function parseBooleanCell(params: {
  value: unknown;
  defaultValue: boolean | null;
  rowNumber: number;
  fieldName: string;
  validationErrors: string[];
}) {
  const normalized = normalizeLookup(params.value);
  if (!normalized) return params.defaultValue;
  if (["SI", "S", "YES", "Y", "TRUE", "1"].includes(normalized)) return true;
  if (["NO", "N", "FALSE", "0"].includes(normalized)) return false;

  params.validationErrors.push(
    `Fila ${params.rowNumber}: valor booleano invalido en ${params.fieldName}: ${normalizeCell(params.value)}`
  );
  return params.defaultValue;
}

function parseAssetCondition(
  value: unknown,
  rowNumber: number,
  validationErrors: string[]
) {
  const normalized = normalizeLookup(value);
  if (!normalized) return null;
  const mapped =
    ASSET_CONDITION_LABELS[normalized as keyof typeof ASSET_CONDITION_LABELS];
  if (mapped) return mapped;

  validationErrors.push(
    `Fila ${rowNumber}: condicion de activo fijo invalida: ${normalizeCell(value)}`
  );
  return null;
}

function validateLength(
  validationErrors: string[],
  rowNumber: number,
  fieldName: string,
  value: string | null,
  limit: number
) {
  if (value && value.length > limit) {
    validationErrors.push(
      `Fila ${rowNumber}: ${fieldName} excede ${limit} caracteres`
    );
  }
}

function chooseSheet(workbook: XLSX.WorkBook, requestedSheetName?: string) {
  if (requestedSheetName) {
    const worksheet = workbook.Sheets[requestedSheetName];
    if (!worksheet) {
      throw new Error(`No se encontro la hoja ${requestedSheetName}`);
    }
    return { sheetName: requestedSheetName, worksheet };
  }

  const sheetName = workbook.Sheets[DEFAULT_SHEET_NAME]
    ? DEFAULT_SHEET_NAME
    : workbook.Sheets[LEGACY_SHEET_NAME]
      ? LEGACY_SHEET_NAME
      : null;

  if (!sheetName) {
    throw new Error(
      `No se encontro la hoja ${DEFAULT_SHEET_NAME} ni ${LEGACY_SHEET_NAME}`
    );
  }

  return { sheetName, worksheet: workbook.Sheets[sheetName] };
}

export function readWorkbook(
  file: string,
  options: { sheetName?: string } = {}
): WorkbookReadResult {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const { sheetName, worksheet } = chooseSheet(workbook, options.sheetName);

  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const headers = (headerRows[0] ?? []).map(normalizeCell).filter(Boolean);
  const actualHeaders = new Set(headers);
  const missingHeaders = REQUIRED_HEADERS.filter(
    header => !actualHeaders.has(header)
  );
  const unmappedColumns = KNOWN_UNMAPPED_HEADERS.filter(header =>
    actualHeaders.has(header)
  );

  const rawRows = XLSX.utils.sheet_to_json<RawExcelRow>(worksheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });

  return {
    file,
    sheetName,
    availableSheets: workbook.SheetNames,
    rawRows,
    headers,
    missingHeaders,
    unmappedColumns,
  };
}

export function parseRows(
  rows: RawExcelRow[],
  options: { missingHeaders?: string[] } = {}
): ParsedRowsResult {
  const parsedRows: ParsedAssetRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const validationErrors = (options.missingHeaders ?? []).map(
    header => `Falta el encabezado requerido: ${header}`
  );

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankExcelRow(row)) continue;

    const rowNumber = index + 2;
    const itemCode = normalizeCell(row["Numero de articulo"]);
    const shortDescription = normalizeCell(row["Descripcion del articulo"]);
    const fullDescription = normalizeCell(
      row["Descripcion del articulo completa"]
    );
    const description = shortDescription || fullDescription;
    const itemGroup = normalizeCell(row["Grupo SAP"]);
    const tipoArticuloRaw = normalizeCell(row["Tipo de articulo"]);
    const tipoArticulo = normalizeLookup(tipoArticuloRaw);
    const projectCodeRaw = normalizeCell(row["Codigo Proyecto"]) || null;
    const projectNameRaw = normalizeCell(row["Nombre Proyecto"]) || null;

    const baseSkipped = {
      rowNumber,
      itemCode: itemCode || null,
      projectCode: projectCodeRaw,
      tipoArticulo: tipoArticuloRaw || null,
      description: description || null,
    };

    if (tipoArticulo !== "ACTIVO" && tipoArticulo !== "ACTIVO FIJO") {
      skippedRows.push({
        ...baseSkipped,
        blocking: false,
        reason: "Tipo de articulo no es ACTIVO",
      });
      continue;
    }

    if (!itemCode) {
      skippedRows.push({
        ...baseSkipped,
        blocking: true,
        reason: "Sin Numero de articulo",
      });
      validationErrors.push(`Fila ${rowNumber}: sin Numero de articulo`);
      continue;
    }

    if (!description) {
      skippedRows.push({
        ...baseSkipped,
        blocking: true,
        reason: "Sin Descripcion del articulo",
      });
      validationErrors.push(`Fila ${rowNumber}: sin Descripcion del articulo`);
      continue;
    }

    if (!itemGroup) {
      skippedRows.push({
        ...baseSkipped,
        blocking: true,
        reason: "Sin Grupo SAP",
      });
      validationErrors.push(`Fila ${rowNumber}: sin Grupo SAP`);
      continue;
    }

    const fixedAssetSerialNumber = nonEmptyOrNull(row["Serie activo fijo"]);
    const fixedAssetColor = nonEmptyOrNull(row["Color activo fijo"]);
    const fixedAssetModel = nonEmptyOrNull(row["Modelo activo fijo"]);
    const fixedAssetBrand = nonEmptyOrNull(row["Marca activo fijo"]);
    const fixedAssetChassisSeries = nonEmptyOrNull(row["Serie chasis"]);
    const fixedAssetMotorSeries = nonEmptyOrNull(row["Serie motor"]);
    const fixedAssetPlateOrCode = nonEmptyOrNull(row["Placa o codigo"]);
    const fixedAssetObservation = nonEmptyOrNull(
      row["Observacion activo fijo"]
    );

    validateLength(validationErrors, rowNumber, "Numero de articulo", itemCode, FIELD_LIMITS.itemCode);
    validateLength(validationErrors, rowNumber, "Descripcion del articulo", description, FIELD_LIMITS.description);
    validateLength(validationErrors, rowNumber, "Grupo SAP", itemGroup, FIELD_LIMITS.itemGroup);
    validateLength(validationErrors, rowNumber, "Serie activo fijo", fixedAssetSerialNumber, FIELD_LIMITS.fixedAssetSerialNumber);
    validateLength(validationErrors, rowNumber, "Color activo fijo", fixedAssetColor, FIELD_LIMITS.fixedAssetColor);
    validateLength(validationErrors, rowNumber, "Modelo activo fijo", fixedAssetModel, FIELD_LIMITS.fixedAssetModel);
    validateLength(validationErrors, rowNumber, "Marca activo fijo", fixedAssetBrand, FIELD_LIMITS.fixedAssetBrand);
    validateLength(validationErrors, rowNumber, "Serie chasis", fixedAssetChassisSeries, FIELD_LIMITS.fixedAssetChassisSeries);
    validateLength(validationErrors, rowNumber, "Serie motor", fixedAssetMotorSeries, FIELD_LIMITS.fixedAssetMotorSeries);
    validateLength(validationErrors, rowNumber, "Placa o codigo", fixedAssetPlateOrCode, FIELD_LIMITS.fixedAssetPlateOrCode);

    parsedRows.push({
      rowNumber,
      itemCode,
      description,
      itemGroup,
      tipoArticulo: "ACTIVO",
      projectCodeRaw,
      projectKey: projectCodeRaw ? normalizeProjectKey(projectCodeRaw) : null,
      projectNameRaw,
      warehouseCodeRaw: normalizeCell(row["Codigo de almacen"]) || null,
      warehouseNameRaw: normalizeCell(row["Nombre de almacen"]) || null,
      allowsTaxWithholding:
        parseBooleanCell({
          value: row["Permite retencion"],
          defaultValue: true,
          rowNumber,
          fieldName: "Permite retencion",
          validationErrors,
        }) ?? true,
      isActive:
        parseBooleanCell({
          value: row["Activo"],
          defaultValue: true,
          rowNumber,
          fieldName: "Activo",
          validationErrors,
        }) ?? true,
      fixedAssetSerialNumber,
      fixedAssetCondition: parseAssetCondition(
        row["Condicion activo fijo"],
        rowNumber,
        validationErrors
      ),
      fixedAssetColor,
      fixedAssetModel,
      fixedAssetBrand,
      fixedAssetChassisSeries,
      fixedAssetMotorSeries,
      fixedAssetPlateOrCode,
      fixedAssetIsLeasing: parseBooleanCell({
        value: row["Es leasing"],
        defaultValue: null,
        rowNumber,
        fieldName: "Es leasing",
        validationErrors,
      }),
      fixedAssetObservation,
    });
  }

  return { parsedRows, skippedRows, validationErrors };
}

export function findDuplicateCodes(rows: ParsedAssetRow[]) {
  const rowsByCode = new Map<string, number[]>();
  for (const row of rows) {
    const bucket = rowsByCode.get(row.itemCode) ?? [];
    bucket.push(row.rowNumber);
    rowsByCode.set(row.itemCode, bucket);
  }
  return Array.from(rowsByCode.entries())
    .filter(([, sourceRows]) => sourceRows.length > 1)
    .map(([itemCode, sourceRows]) => ({ itemCode, sourceRows }))
    .sort((left, right) => left.itemCode.localeCompare(right.itemCode));
}

async function loadProjects(client: Client) {
  const result = await client.query<ProjectRef>(
    `select id, code, name
       from projects
      order by code`
  );
  return result.rows;
}

export function buildProjectLookup(projects: ProjectRef[]) {
  const lookup = new Map<string, ProjectRef>();
  for (const project of projects) {
    lookup.set(normalizeProjectKey(project.code), project);
  }
  return lookup;
}

export function resolveProjects(
  rows: ParsedAssetRow[],
  projectLookup: Map<string, ProjectRef>
) {
  const resolvedRows: ResolvedAssetRow[] = [];
  const missingProjectsByKey = new Map<string, MissingProject>();

  for (const row of rows) {
    if (!row.projectKey) {
      resolvedRows.push({ ...row, project: null, projectId: null });
      continue;
    }

    const project = projectLookup.get(row.projectKey);
    if (!project) {
      const existing = missingProjectsByKey.get(row.projectKey);
      if (existing) {
        existing.rows.push(row.rowNumber);
      } else {
        missingProjectsByKey.set(row.projectKey, {
          projectCode: row.projectCodeRaw ?? "",
          projectKey: row.projectKey,
          projectName: row.projectNameRaw,
          rows: [row.rowNumber],
        });
      }
      continue;
    }

    resolvedRows.push({ ...row, project, projectId: project.id });
  }

  return {
    resolvedRows,
    missingProjects: Array.from(missingProjectsByKey.values()).sort((left, right) =>
      left.projectKey.localeCompare(right.projectKey, "es-HN", { numeric: true })
    ),
  };
}

async function loadExistingAssets(client: Client, itemCodes: string[]) {
  const rows: ExistingAssetRow[] = [];
  const uniqueCodes = Array.from(new Set(itemCodes));

  for (const chunk of chunkItems(uniqueCodes, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingAssetRow>(
      `select id,
              "itemCode",
              description,
              "itemGroup",
              "tipoArticulo",
              "projectId",
              "allowsTaxWithholding",
              "isActive",
              "fixedAssetStatus",
              "fixedAssetSourcePurchaseOrderId",
              "fixedAssetSourcePurchaseOrderItemId",
              "fixedAssetSerialNumber",
              "fixedAssetCondition"::text as "fixedAssetCondition",
              "fixedAssetColor",
              "fixedAssetModel",
              "fixedAssetBrand",
              "fixedAssetChassisSeries",
              "fixedAssetMotorSeries",
              "fixedAssetPlateOrCode",
              "fixedAssetIsLeasing",
              "fixedAssetObservation"
         from "sapCatalog"
        where "itemCode" = any($1::text[])
        order by "itemCode"`,
      [chunk]
    );
    rows.push(...result.rows);
  }

  return rows;
}

function buildFieldChangeMap(
  expected: Record<AssetImportField, unknown>,
  previous: ExistingAssetRow
) {
  const actualByField: Record<AssetImportField, unknown> = {
    description: previous.description,
    itemGroup: previous.itemGroup,
    projectId: previous.projectId,
    allowsTaxWithholding: previous.allowsTaxWithholding,
    tipoArticulo: previous.tipoArticulo,
    isActive: previous.isActive,
    fixedAssetSerialNumber: previous.fixedAssetSerialNumber,
    fixedAssetCondition: previous.fixedAssetCondition,
    fixedAssetColor: previous.fixedAssetColor,
    fixedAssetModel: previous.fixedAssetModel,
    fixedAssetBrand: previous.fixedAssetBrand,
    fixedAssetChassisSeries: previous.fixedAssetChassisSeries,
    fixedAssetMotorSeries: previous.fixedAssetMotorSeries,
    fixedAssetPlateOrCode: previous.fixedAssetPlateOrCode,
    fixedAssetIsLeasing: previous.fixedAssetIsLeasing,
    fixedAssetObservation: previous.fixedAssetObservation,
  };

  return Object.fromEntries(
    ASSET_IMPORT_FIELDS.map(field => [
      field,
      (actualByField[field] ?? null) !== (expected[field] ?? null),
    ])
  ) as Record<AssetImportField, boolean>;
}

function plannedInsertFromRow(row: ResolvedAssetRow): PlannedInsert {
  return {
    itemCode: row.itemCode,
    description: row.description,
    itemGroup: row.itemGroup,
    tipoArticulo: 3,
    projectId: row.projectId,
    allowsTaxWithholding: row.allowsTaxWithholding,
    isActive: row.isActive,
    fixedAssetSerialNumber: row.fixedAssetSerialNumber,
    fixedAssetCondition: row.fixedAssetCondition,
    fixedAssetColor: row.fixedAssetColor,
    fixedAssetModel: row.fixedAssetModel,
    fixedAssetBrand: row.fixedAssetBrand,
    fixedAssetChassisSeries: row.fixedAssetChassisSeries,
    fixedAssetMotorSeries: row.fixedAssetMotorSeries,
    fixedAssetPlateOrCode: row.fixedAssetPlateOrCode,
    fixedAssetIsLeasing: row.fixedAssetIsLeasing ?? false,
    fixedAssetObservation: row.fixedAssetObservation,
    sourceRow: row.rowNumber,
    projectCodeRaw: row.projectCodeRaw,
    projectNameRaw: row.projectNameRaw,
  };
}

function plannedUpdateFromRow(
  row: ResolvedAssetRow,
  existing: ExistingAssetRow
): PlannedUpdate {
  const expected = {
    description: row.description,
    itemGroup: row.itemGroup,
    projectId: row.projectId,
    allowsTaxWithholding: row.allowsTaxWithholding,
    tipoArticulo: 3,
    isActive: row.isActive,
    fixedAssetSerialNumber:
      row.fixedAssetSerialNumber ?? existing.fixedAssetSerialNumber,
    fixedAssetCondition:
      row.fixedAssetCondition ?? (existing.fixedAssetCondition as AssetCondition | null),
    fixedAssetColor: row.fixedAssetColor ?? existing.fixedAssetColor,
    fixedAssetModel: row.fixedAssetModel ?? existing.fixedAssetModel,
    fixedAssetBrand: row.fixedAssetBrand ?? existing.fixedAssetBrand,
    fixedAssetChassisSeries:
      row.fixedAssetChassisSeries ?? existing.fixedAssetChassisSeries,
    fixedAssetMotorSeries:
      row.fixedAssetMotorSeries ?? existing.fixedAssetMotorSeries,
    fixedAssetPlateOrCode:
      row.fixedAssetPlateOrCode ?? existing.fixedAssetPlateOrCode,
    fixedAssetIsLeasing: row.fixedAssetIsLeasing ?? existing.fixedAssetIsLeasing,
    fixedAssetObservation:
      row.fixedAssetObservation ?? existing.fixedAssetObservation,
  } satisfies Record<AssetImportField, unknown>;
  const fieldChanges = buildFieldChangeMap(expected, existing);

  return {
    id: existing.id,
    itemCode: row.itemCode,
    description: expected.description,
    itemGroup: expected.itemGroup,
    tipoArticulo: 3,
    projectId: expected.projectId,
    allowsTaxWithholding: expected.allowsTaxWithholding,
    isActive: expected.isActive,
    fixedAssetSerialNumber: expected.fixedAssetSerialNumber,
    fixedAssetCondition: expected.fixedAssetCondition,
    fixedAssetColor: expected.fixedAssetColor,
    fixedAssetModel: expected.fixedAssetModel,
    fixedAssetBrand: expected.fixedAssetBrand,
    fixedAssetChassisSeries: expected.fixedAssetChassisSeries,
    fixedAssetMotorSeries: expected.fixedAssetMotorSeries,
    fixedAssetPlateOrCode: expected.fixedAssetPlateOrCode,
    fixedAssetIsLeasing: expected.fixedAssetIsLeasing,
    fixedAssetObservation: expected.fixedAssetObservation,
    sourceRow: row.rowNumber,
    projectCodeRaw: row.projectCodeRaw,
    projectNameRaw: row.projectNameRaw,
    previous: existing,
    changedFields: ASSET_IMPORT_FIELDS.filter(field => fieldChanges[field]),
    fieldChanges,
  } as PlannedUpdate;
}

export function buildPlan(
  rows: ResolvedAssetRow[],
  existingAssets: ExistingAssetRow[]
) {
  const existingByCode = new Map(existingAssets.map(row => [row.itemCode, row]));
  const updates: PlannedUpdate[] = [];
  const inserts: PlannedInsert[] = [];

  for (const row of rows) {
    const existing = existingByCode.get(row.itemCode);
    if (existing) {
      updates.push(plannedUpdateFromRow(row, existing));
      continue;
    }

    inserts.push(plannedInsertFromRow(row));
  }

  return { updates, inserts } satisfies ImportPlan;
}

function summarizeByProject(
  rows: Array<{ projectId: number | null; project?: ProjectRef | null }>
) {
  const summariesByProjectId = new Map<string, ProjectSummary>();

  for (const row of rows) {
    const key = String(row.projectId ?? "null");
    const existing = summariesByProjectId.get(key);
    if (existing) {
      existing.rows += 1;
      continue;
    }

    summariesByProjectId.set(key, {
      projectId: row.projectId,
      projectCode: row.project?.code ?? null,
      projectName: row.project?.name ?? null,
      rows: 1,
    });
  }

  return Array.from(summariesByProjectId.values()).sort((left, right) => {
    if (left.projectId === null && right.projectId !== null) return -1;
    if (left.projectId !== null && right.projectId === null) return 1;
    return String(left.projectCode ?? "").localeCompare(String(right.projectCode ?? ""), "es-HN", {
      numeric: true,
    });
  });
}

function buildExpectedByCode(plan: ImportPlan) {
  const expected = new Map<string, PlannedInsert | PlannedUpdate>();
  for (const row of plan.updates) expected.set(row.itemCode, row);
  for (const row of plan.inserts) expected.set(row.itemCode, row);
  return expected;
}

function countFieldChanges(rows: PlannedUpdate[]) {
  const counts = Object.fromEntries(
    ASSET_IMPORT_FIELDS.map(field => [field, 0])
  ) as Record<AssetImportField, number>;

  for (const row of rows) {
    for (const field of ASSET_IMPORT_FIELDS) {
      if (row.fieldChanges[field]) counts[field] += 1;
    }
  }

  return counts;
}

async function updateAssets(client: Client, rows: PlannedUpdate[]) {
  let updated = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `update "sapCatalog" as asset
          set description = x.description,
              "itemGroup" = x."itemGroup",
              "tipoArticulo" = 3,
              "projectId" = x."projectId",
              "allowsTaxWithholding" = x."allowsTaxWithholding",
              "isActive" = x."isActive",
              "fixedAssetSerialNumber" = x."fixedAssetSerialNumber",
              "fixedAssetCondition" = case
                when x."fixedAssetCondition" is null then null
                else x."fixedAssetCondition"::item_condition
              end,
              "fixedAssetColor" = x."fixedAssetColor",
              "fixedAssetModel" = x."fixedAssetModel",
              "fixedAssetBrand" = x."fixedAssetBrand",
              "fixedAssetChassisSeries" = x."fixedAssetChassisSeries",
              "fixedAssetMotorSeries" = x."fixedAssetMotorSeries",
              "fixedAssetPlateOrCode" = x."fixedAssetPlateOrCode",
              "fixedAssetIsLeasing" = x."fixedAssetIsLeasing",
              "fixedAssetObservation" = x."fixedAssetObservation",
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           description text,
           "itemGroup" text,
           "projectId" integer,
           "allowsTaxWithholding" boolean,
           "isActive" boolean,
           "fixedAssetSerialNumber" text,
           "fixedAssetCondition" text,
           "fixedAssetColor" text,
           "fixedAssetModel" text,
           "fixedAssetBrand" text,
           "fixedAssetChassisSeries" text,
           "fixedAssetMotorSeries" text,
           "fixedAssetPlateOrCode" text,
           "fixedAssetIsLeasing" boolean,
           "fixedAssetObservation" text
         )
        where asset.id = x.id`,
      [JSON.stringify(chunk)]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

async function insertAssets(client: Client, rows: PlannedInsert[]) {
  const inserted: AppliedInsert[] = [];
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<AppliedInsert>(
      `insert into "sapCatalog"
        (
          "itemCode",
          description,
          "itemGroup",
          "tipoArticulo",
          "projectId",
          "allowsTaxWithholding",
          "isActive",
          "fixedAssetSerialNumber",
          "fixedAssetCondition",
          "fixedAssetColor",
          "fixedAssetModel",
          "fixedAssetBrand",
          "fixedAssetChassisSeries",
          "fixedAssetMotorSeries",
          "fixedAssetPlateOrCode",
          "fixedAssetIsLeasing",
          "fixedAssetObservation",
          "updatedAt"
        )
       select x."itemCode",
              x.description,
              x."itemGroup",
              3,
              x."projectId",
              x."allowsTaxWithholding",
              x."isActive",
              x."fixedAssetSerialNumber",
              case
                when x."fixedAssetCondition" is null then null
                else x."fixedAssetCondition"::item_condition
              end,
              x."fixedAssetColor",
              x."fixedAssetModel",
              x."fixedAssetBrand",
              x."fixedAssetChassisSeries",
              x."fixedAssetMotorSeries",
              x."fixedAssetPlateOrCode",
              x."fixedAssetIsLeasing",
              x."fixedAssetObservation",
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "itemCode" text,
           description text,
           "itemGroup" text,
           "projectId" integer,
           "allowsTaxWithholding" boolean,
           "isActive" boolean,
           "fixedAssetSerialNumber" text,
           "fixedAssetCondition" text,
           "fixedAssetColor" text,
           "fixedAssetModel" text,
           "fixedAssetBrand" text,
           "fixedAssetChassisSeries" text,
           "fixedAssetMotorSeries" text,
           "fixedAssetPlateOrCode" text,
           "fixedAssetIsLeasing" boolean,
           "fixedAssetObservation" text
         )
      returning id, "itemCode"`,
      [JSON.stringify(chunk)]
    );
    inserted.push(...result.rows);
  }
  return inserted;
}

async function applyImport(client: Client, plan: ImportPlan) {
  await client.query("begin");
  try {
    const updated = await updateAssets(client, plan.updates);
    const insertedRows = await insertAssets(client, plan.inserts);
    await client.query("commit");
    return {
      result: {
        updated,
        inserted: insertedRows.length,
      },
      insertedRows,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function verifyImport(
  client: Client,
  plan: ImportPlan,
  resolvedRows: ResolvedAssetRow[]
) {
  const expectedByCode = buildExpectedByCode(plan);
  const itemCodes = Array.from(expectedByCode.keys());
  const dbRows: Array<{
    itemCode: string;
    description: string;
    itemGroup: string | null;
    tipoArticulo: number;
    projectId: number | null;
    allowsTaxWithholding: boolean;
    isActive: boolean;
    fixedAssetSerialNumber: string | null;
    fixedAssetCondition: string | null;
    fixedAssetColor: string | null;
    fixedAssetModel: string | null;
    fixedAssetBrand: string | null;
    fixedAssetChassisSeries: string | null;
    fixedAssetMotorSeries: string | null;
    fixedAssetPlateOrCode: string | null;
    fixedAssetIsLeasing: boolean;
    fixedAssetObservation: string | null;
    projectCode: string | null;
    projectName: string | null;
  }> = [];

  for (const chunk of chunkItems(itemCodes, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<(typeof dbRows)[number]>(
      `select sc."itemCode",
              sc.description,
              sc."itemGroup",
              sc."tipoArticulo",
              sc."projectId",
              sc."allowsTaxWithholding",
              sc."isActive",
              sc."fixedAssetSerialNumber",
              sc."fixedAssetCondition"::text as "fixedAssetCondition",
              sc."fixedAssetColor",
              sc."fixedAssetModel",
              sc."fixedAssetBrand",
              sc."fixedAssetChassisSeries",
              sc."fixedAssetMotorSeries",
              sc."fixedAssetPlateOrCode",
              sc."fixedAssetIsLeasing",
              sc."fixedAssetObservation",
              p.code as "projectCode",
              p.name as "projectName"
         from "sapCatalog" sc
         left join projects p on p.id = sc."projectId"
        where sc."itemCode" = any($1::text[])`,
      [chunk]
    );
    dbRows.push(...result.rows);
  }

  const dbByCode = new Map(dbRows.map(row => [row.itemCode, row]));
  const missingImportedCodes = itemCodes.filter(code => !dbByCode.has(code));
  const nonAssetRows = dbRows
    .filter(row => row.tipoArticulo !== 3)
    .map(row => ({ itemCode: row.itemCode, tipoArticulo: row.tipoArticulo }));
  const fieldMismatches: FieldMismatch[] = [];

  for (const row of dbRows) {
    const expected = expectedByCode.get(row.itemCode);
    if (!expected) continue;
    for (const field of ASSET_IMPORT_FIELDS) {
      if ((row[field] ?? null) !== (expected[field] ?? null)) {
        fieldMismatches.push({
          itemCode: row.itemCode,
          field,
          expected: expected[field],
          actual: row[field],
        });
      }
    }
  }

  const projectSummary = summarizeByProject(
    dbRows.map(row => ({
      projectId: row.projectId,
      project: row.projectId
        ? {
            id: row.projectId,
            code: row.projectCode ?? "",
            name: row.projectName ?? "",
          }
        : null,
    }))
  );

  return {
    importedCodesFound: dbRows.length,
    importedCodesWithAssetType: dbRows.filter(row => row.tipoArticulo === 3).length,
    missingImportedCodes,
    nonAssetRows,
    fieldMismatches,
    projectSummary,
  } satisfies Verification;
}

function buildReport(params: {
  mode: Mode;
  file: string;
  sheetName: string;
  availableSheets: string[];
  rawRows: number;
  unmappedColumns: string[];
  parsedRows: ParsedAssetRow[];
  skippedRows: SkippedRow[];
  validationErrors: string[];
  duplicateCodes: DuplicateCode[];
  missingProjects: MissingProject[];
  resolvedRows: ResolvedAssetRow[];
  plan: ImportPlan;
  applyResult?: ImportReport["applyResult"];
  insertedRows?: AppliedInsert[];
  verification?: Verification;
}) {
  const insertedIdByCode = new Map(
    (params.insertedRows ?? []).map(row => [row.itemCode, row.id])
  );
  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    source: {
      file: params.file,
      sheetName: params.sheetName,
      availableSheets: params.availableSheets,
      rawRows: params.rawRows,
      unmappedColumns: params.unmappedColumns,
    },
    summary: {
      rawRows: params.rawRows,
      parsedRows: params.parsedRows.length,
      uniqueCodes: new Set(params.parsedRows.map(row => row.itemCode)).size,
      skippedRows: params.skippedRows.length,
      blockingSkippedRows: params.skippedRows.filter(row => row.blocking).length,
      duplicateCodes: params.duplicateCodes.length,
      missingProjects: params.missingProjects.length,
      validationErrors: params.validationErrors.length,
      existingRows: params.plan.updates.length,
      updates: params.plan.updates.length,
      inserts: params.plan.inserts.length,
      fieldChanges: countFieldChanges(params.plan.updates),
    },
    applyResult: params.applyResult,
    projectSummary: summarizeByProject(params.resolvedRows),
    skippedRows: params.skippedRows,
    duplicateCodes: params.duplicateCodes,
    missingProjects: params.missingProjects,
    validationErrors: params.validationErrors,
    updatedRows: params.plan.updates,
    insertedRows: params.plan.inserts.map(row => ({
      ...row,
      id: insertedIdByCode.get(row.itemCode),
    })),
    verification: params.verification,
  } satisfies ImportReport;
}

async function writeReport(reportPath: string | undefined, report: ImportReport) {
  if (!reportPath) return;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report: ImportReport) {
  console.log(`Modo: ${report.mode}`);
  console.log(`Archivo: ${report.source.file}`);
  console.log(`Hoja: ${report.source.sheetName}`);
  console.log(`Filas Excel: ${report.summary.rawRows}`);
  console.log(`Filas validas: ${report.summary.parsedRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Filas omitidas: ${report.summary.skippedRows}`);
  console.log(`Omisiones bloqueantes: ${report.summary.blockingSkippedRows}`);
  console.log(`Codigos duplicados: ${report.summary.duplicateCodes}`);
  console.log(`Proyectos sin empatar: ${report.summary.missingProjects}`);
  console.log(`Errores de validacion: ${report.summary.validationErrors}`);
  console.log(`Actualizaciones: ${report.summary.updates}`);
  console.log(`Inserciones: ${report.summary.inserts}`);
  console.log(`Cambios por campo: ${JSON.stringify(report.summary.fieldChanges)}`);
  if (report.source.unmappedColumns.length > 0) {
    console.log(`Columnas no cargadas: ${report.source.unmappedColumns.join(", ")}`);
  }
  if (report.applyResult) {
    console.log(`Aplicado - actualizadas: ${report.applyResult.updated}`);
    console.log(`Aplicado - insertadas: ${report.applyResult.inserted}`);
  }
  for (const summary of report.projectSummary) {
    const label = summary.projectCode
      ? `${summary.projectCode} - ${summary.projectName}`
      : "Sin proyecto";
    console.log(`${label}: ${summary.rows}`);
  }
  if (report.verification) {
    console.log(`Verificacion - codigos encontrados: ${report.verification.importedCodesFound}`);
    console.log(
      `Verificacion - tipo activo: ${report.verification.importedCodesWithAssetType}`
    );
    console.log(
      `Verificacion - diferencias de campos: ${report.verification.fieldMismatches.length}`
    );
  }
}

export async function buildImportPlan(
  client: Client,
  file: string,
  options: { sheetName?: string } = {}
) {
  const workbook = readWorkbook(file, options);
  const { parsedRows, skippedRows, validationErrors } = parseRows(
    workbook.rawRows,
    {
      missingHeaders: workbook.missingHeaders,
    }
  );
  const duplicateCodes = findDuplicateCodes(parsedRows);
  const projects = await loadProjects(client);
  const { resolvedRows, missingProjects } = resolveProjects(
    parsedRows,
    buildProjectLookup(projects)
  );
  const existingAssets = await loadExistingAssets(
    client,
    resolvedRows.map(row => row.itemCode)
  );
  const plan = buildPlan(resolvedRows, existingAssets);

  return {
    file,
    sheetName: workbook.sheetName,
    availableSheets: workbook.availableSheets,
    rawRows: workbook.rawRows.length,
    unmappedColumns: workbook.unmappedColumns,
    parsedRows,
    skippedRows,
    validationErrors,
    duplicateCodes,
    missingProjects,
    resolvedRows,
    plan,
  };
}

export function assertPlanCanApply(
  planData: Awaited<ReturnType<typeof buildImportPlan>>
) {
  const problems: string[] = [];
  if (planData.validationErrors.length > 0) {
    problems.push(`${planData.validationErrors.length} errores de validacion`);
  }
  if (planData.skippedRows.some(row => row.blocking)) {
    problems.push(
      `${planData.skippedRows.filter(row => row.blocking).length} filas omitidas bloqueantes`
    );
  }
  if (planData.duplicateCodes.length > 0) {
    problems.push(`${planData.duplicateCodes.length} codigos duplicados`);
  }
  if (planData.missingProjects.length > 0) {
    problems.push(`${planData.missingProjects.length} proyectos sin empatar`);
  }
  if (problems.length > 0) {
    throw new Error(`No se aplico la carga: ${problems.join(", ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: requireDatabaseUrl() });

  await client.connect();
  try {
    const planData = await buildImportPlan(client, options.file, {
      sheetName: options.sheetName,
    });
    let applyResult: ImportReport["applyResult"] | undefined;
    let insertedRows: AppliedInsert[] | undefined;
    let verification: Verification | undefined;

    if (options.mode === "apply") {
      assertPlanCanApply(planData);
      const applied = await applyImport(client, planData.plan);
      applyResult = applied.result;
      insertedRows = applied.insertedRows;
      verification = await verifyImport(
        client,
        planData.plan,
        planData.resolvedRows
      );
    }

    const report = buildReport({
      mode: options.mode,
      ...planData,
      applyResult,
      insertedRows,
      verification,
    });
    await writeReport(options.report, report);
    printSummary(report);
    if (options.report) console.log(`Reporte: ${options.report}`);

    if (options.mode === "dry-run") {
      assertPlanCanApply(planData);
    }
  } finally {
    await client.end();
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedPath === currentFilePath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
