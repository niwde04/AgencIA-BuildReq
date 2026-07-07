import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const DEFAULT_SHEET_NAME = "Inventario";
const BATCH_SIZE = 500;
const PRODUCT_ARTICLE_TYPE = 1;

const REQUIRED_HEADERS = [
  "codigo_sap*",
  "descripcion_articulo*",
  "tipo_articulo*",
  "codigo_almacen*",
  "cantidad_inicial*",
] as const;

const KNOWN_UNMAPPED_HEADERS = [
  "nombre_almacen",
  "nombre_bodega",
  "fecha_saldo",
  "habilitado",
  "notas",
] as const;

const FIELD_LIMITS = {
  itemCode: 50,
  description: 500,
  itemGroup: 255,
  brand: 120,
  partNumber: 120,
  unit: 50,
  category: 100,
  storageLocation: 255,
} as const;

type Mode = "dry-run" | "apply";

type CliOptions = {
  mode: Mode;
  file: string;
  report?: string;
  sheetName?: string;
};

type RawExcelRow = Record<string, unknown>;

type Variant = {
  value: string;
  count: number;
  firstRow: number;
};

type ConflictReport = {
  scope: "catalog" | "inventory";
  key: string;
  field: string;
  variants: Variant[];
};

export type SkippedRow = {
  rowNumber: number;
  reason: string;
  blocking: boolean;
  itemCode: string | null;
  warehouseCode: string | null;
  projectCode: string | null;
};

export type ParsedProductInventoryRow = {
  rowNumber: number;
  itemCode: string;
  description: string;
  itemGroup: string;
  unit: string | null;
  category: string | null;
  brand: string | null;
  partNumber: string | null;
  warehouseCodeRaw: string;
  warehouseKey: string;
  projectCodeRaw: string;
  projectKey: string;
  bodegaCodeRaw: string | null;
  quantity: number;
  minimumStock: number | null;
  storageLocation: string | null;
  isActive: boolean;
};

export type CatalogProductInput = {
  itemCode: string;
  description: string;
  itemGroup: string | null;
  brand: string | null;
  partNumber: string | null;
  isActive: boolean;
  sourceRows: number[];
};

export type InventoryInput = {
  key: string;
  sapItemCode: string;
  warehouseCodeRaw: string;
  warehouseKey: string;
  projectCodeRaw: string;
  projectKey: string;
  name: string;
  description: string;
  unit: string | null;
  category: string | null;
  currentStock: number;
  minimumStock: number | null;
  storageLocation: string | null;
  isActive: boolean;
  sourceRows: number[];
};

export type ImportData = {
  file: string;
  sheetName: string;
  rawRows: number;
  parsedRows: ParsedProductInventoryRow[];
  skippedRows: SkippedRow[];
  products: CatalogProductInput[];
  inventory: InventoryInput[];
  conflicts: ConflictReport[];
  validationErrors: string[];
};

export type DbProject = {
  id: number;
  code: string;
  sapProjectCode: string | null;
  name: string;
  status: string;
};

export type DbWarehouse = {
  id: number;
  code: string;
  localCode: string | null;
  name: string;
  displayName: string;
  isActive: boolean;
};

type Relations = {
  projectsByExactCode: Map<string, DbProject>;
  projectsByKey: Map<string, DbProject>;
  warehousesByExactCode: Map<string, DbWarehouse>;
  warehousesByKey: Map<string, DbWarehouse>;
  assignmentKeys: Set<string>;
};

type MissingProject = {
  projectCode: string;
  projectKey: string;
  rows: number[];
};

type MissingWarehouse = {
  warehouseCode: string;
  warehouseKey: string;
  rows: number[];
};

type MissingAssignment = {
  projectId: number;
  projectCode: string;
  warehouseId: number;
  warehouseCode: string;
  rows: number[];
};

type ResolvedInventoryInput = InventoryInput & {
  project: DbProject;
  warehouse: DbWarehouse;
  projectId: number;
  warehouseId: number;
  warehouseLocation: string;
};

export type ExistingCatalogRow = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  brand: string | null;
  partNumber: string | null;
  tipoArticulo: number;
  isActive: boolean;
};

export type ExistingInventoryRow = {
  id: number;
  sapItemCode: string;
  projectId: number | null;
  warehouseId: number | null;
  storageLocation: string | null;
};

type CatalogWrite = CatalogProductInput & {
  tipoArticulo: 1;
  existing?: ExistingCatalogRow;
};

type InventoryWrite = ResolvedInventoryInput & {
  id?: number;
  storageLocationForDb: string | null;
  existing?: ExistingInventoryRow;
};

export type ImportPlan = {
  catalog: {
    inserts: CatalogWrite[];
    updates: CatalogWrite[];
    existingAssetConflicts: ExistingCatalogRow[];
  };
  inventory: {
    inserts: InventoryWrite[];
    updates: InventoryWrite[];
    existingDuplicateKeys: number;
  };
};

type VerificationResult = {
  assets: {
    total: number;
    active: number;
  };
  products: {
    expectedCodes: number;
    importedCodesFound: number;
    importedCodesTipoArticulo1: number;
    totalTipoArticulo1: number;
  };
  inventory: {
    expectedGroups: number;
    importedRowsFound: number;
    totalStock: string;
    expectedTotalStock: string;
    nonProductInventoryRows: number;
    rowsOutsideExpectedScope: number;
    storageLocationRows: number;
    expectedStorageLocationRows: number;
  };
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
    uniqueProductCodes: number;
    inventoryGroups: number;
    totalStock: string;
    storageLocationGroups: number;
    skippedRows: number;
    blockingSkippedRows: number;
    validationErrors: number;
    conflicts: number;
    missingProjects: number;
    missingWarehouses: number;
    missingAssignments: number;
    existingAssetConflicts: number;
    catalog: {
      inserts: number;
      updates: number;
    };
    inventory: {
      inserts: number;
      updates: number;
      existingDuplicateKeys: number;
    };
  };
  skippedRows: SkippedRow[];
  conflicts: ConflictReport[];
  validationErrors: string[];
  missingProjects: MissingProject[];
  missingWarehouses: MissingWarehouse[];
  missingAssignments: MissingAssignment[];
  existingAssetConflicts: ExistingCatalogRow[];
  catalogInserts: CatalogWrite[];
  catalogUpdates: CatalogWrite[];
  inventoryInserts: InventoryWrite[];
  inventoryUpdates: InventoryWrite[];
  applyResult?: {
    catalog: {
      inserted: number;
      updated: number;
    };
    inventory: {
      inserted: number;
      updated: number;
    };
  };
  verification?: VerificationResult;
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-products-inventory-hidalgo.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-products-inventory-hidalgo.ts --file <xlsx> --apply --report <json>",
      "  Optional: --sheet <sheet-name>",
    ].join("\n")
  );
}

export function parseArgs(argv: string[]): CliOptions {
  let mode: Mode = "dry-run";
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
  if (!file) throw new Error("Debe indicar --file <xlsx>");
  return { mode, file, report, sheetName };
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeUpper(value: unknown) {
  return normalizeCell(value).toUpperCase();
}

export function normalizeProjectKey(value: unknown) {
  const raw = normalizeUpper(value);
  if (!raw) return "";
  const withoutLeadingZeroes = raw.replace(/^0+/, "");
  return withoutLeadingZeroes || "0";
}

export function normalizeWarehouseKey(value: unknown) {
  return normalizeProjectKey(value);
}

function nullableText(value: unknown) {
  const normalized = normalizeCell(value);
  return normalized ? normalized : null;
}

function parseBoolean(value: unknown, defaultValue: boolean) {
  const normalized = normalizeUpper(value);
  if (!normalized) return { value: defaultValue, valid: true };
  if (["SI", "SÍ", "YES", "Y", "TRUE", "1", "ACTIVO"].includes(normalized)) {
    return { value: true, valid: true };
  }
  if (["NO", "N", "FALSE", "0", "INACTIVO"].includes(normalized)) {
    return { value: false, valid: true };
  }
  return { value: defaultValue, valid: false };
}

function parseDecimal(value: unknown) {
  const normalized = normalizeCell(value);
  if (!normalized) return { value: null, valid: true };
  let numericText = normalized.replace(/\s/g, "");
  if (numericText.includes(",") && numericText.includes(".")) {
    numericText = numericText.replace(/,/g, "");
  } else if (numericText.includes(",") && !numericText.includes(".")) {
    numericText = numericText.replace(",", ".");
  }
  const numeric = Number(numericText);
  return {
    value: Number.isFinite(numeric) ? numeric : null,
    valid: Number.isFinite(numeric),
  };
}

function formatDecimal(value: number) {
  return value.toFixed(2);
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isBlankRow(row: RawExcelRow) {
  return Object.values(row).every(value => normalizeCell(value) === "");
}

function isTotalRow(row: RawExcelRow) {
  const code = normalizeUpper(row["codigo_sap*"]);
  const description = normalizeUpper(row["descripcion_articulo*"]);
  return code === "TOTAL" || description === "TOTAL";
}

function collectHeaders(rows: RawExcelRow[]) {
  const headers = new Set<string>();
  for (const row of rows) {
    for (const header of Object.keys(row)) {
      headers.add(header);
    }
  }
  return Array.from(headers);
}

export function readWorkbook(file: string, sheetName?: string) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const selectedSheet = sheetName ?? DEFAULT_SHEET_NAME;
  if (!workbook.Sheets[selectedSheet]) {
    throw new Error(
      `La hoja "${selectedSheet}" no existe. Hojas disponibles: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rawRows = XLSX.utils.sheet_to_json<RawExcelRow>(
    workbook.Sheets[selectedSheet],
    {
      defval: null,
      raw: false,
    }
  );
  const headers = collectHeaders(rawRows);
  const missingHeaders = REQUIRED_HEADERS.filter(
    header => !headers.includes(header)
  );
  const mappedHeaders = new Set([
    ...REQUIRED_HEADERS,
    "unidad",
    "categoria",
    "marca",
    "numero_parte",
    "codigo_bodega",
    "ubicacion",
    "stock_minimo",
  ]);
  const unmappedColumns = headers.filter(
    header =>
      !mappedHeaders.has(header) ||
      (KNOWN_UNMAPPED_HEADERS as readonly string[]).includes(header)
  );

  return {
    sheetName: selectedSheet,
    availableSheets: workbook.SheetNames,
    rawRows,
    missingHeaders,
    unmappedColumns,
  };
}

function addValidationError(errors: string[], rowNumber: number, message: string) {
  errors.push(`Fila ${rowNumber}: ${message}`);
}

function validateLength(
  errors: string[],
  rowNumber: number,
  field: string,
  value: string | null,
  limit: number
) {
  if (value && value.length > limit) {
    addValidationError(
      errors,
      rowNumber,
      `${field} excede ${limit} caracteres (${value.length})`
    );
  }
}

export function parseRows(
  rawRows: RawExcelRow[],
  options: { missingHeaders?: readonly string[] } = {}
) {
  const parsedRows: ParsedProductInventoryRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const validationErrors = [...(options.missingHeaders ?? []).map(
    header => `Encabezado requerido faltante: ${header}`
  )];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(row)) {
      skippedRows.push({
        rowNumber,
        reason: "Fila vacia",
        blocking: false,
        itemCode: null,
        warehouseCode: null,
        projectCode: null,
      });
      return;
    }
    if (isTotalRow(row)) {
      skippedRows.push({
        rowNumber,
        reason: "Fila total omitida",
        blocking: false,
        itemCode: normalizeCell(row["codigo_sap*"]) || null,
        warehouseCode: normalizeCell(row["codigo_almacen*"]) || null,
        projectCode: normalizeCell(row["codigo_bodega"]) || null,
      });
      return;
    }

    const itemCode = normalizeUpper(row["codigo_sap*"]);
    const description = normalizeCell(row["descripcion_articulo*"]);
    const itemGroup = normalizeCell(row["tipo_articulo*"]);
    const warehouseCodeRaw = normalizeUpper(row["codigo_almacen*"]);
    const bodegaCodeRaw = nullableText(row["codigo_bodega"]);
    const projectCodeRaw = normalizeUpper(bodegaCodeRaw || warehouseCodeRaw);
    const quantity = parseDecimal(row["cantidad_inicial*"]);
    const minimumStock = parseDecimal(row["stock_minimo"]);
    const enabled = parseBoolean(row["habilitado"], true);
    const storageLocation = nullableText(row["ubicacion"]);

    if (!itemCode) {
      addValidationError(validationErrors, rowNumber, "codigo_sap* es requerido");
    }
    if (!description) {
      addValidationError(
        validationErrors,
        rowNumber,
        "descripcion_articulo* es requerido"
      );
    }
    if (!itemGroup) {
      addValidationError(
        validationErrors,
        rowNumber,
        "tipo_articulo* es requerido"
      );
    }
    if (!warehouseCodeRaw) {
      addValidationError(
        validationErrors,
        rowNumber,
        "codigo_almacen* es requerido"
      );
    }
    if (quantity.value === null || !quantity.valid) {
      addValidationError(
        validationErrors,
        rowNumber,
        "cantidad_inicial* debe ser numerico"
      );
    }
    if (!minimumStock.valid) {
      addValidationError(validationErrors, rowNumber, "stock_minimo debe ser numerico");
    }
    if (!enabled.valid) {
      addValidationError(
        validationErrors,
        rowNumber,
        "habilitado debe ser SI/NO o verdadero/falso"
      );
    }

    validateLength(validationErrors, rowNumber, "codigo_sap*", itemCode, FIELD_LIMITS.itemCode);
    validateLength(
      validationErrors,
      rowNumber,
      "descripcion_articulo*",
      description,
      FIELD_LIMITS.description
    );
    validateLength(validationErrors, rowNumber, "tipo_articulo*", itemGroup, FIELD_LIMITS.itemGroup);
    validateLength(validationErrors, rowNumber, "marca", nullableText(row["marca"]), FIELD_LIMITS.brand);
    validateLength(
      validationErrors,
      rowNumber,
      "numero_parte",
      nullableText(row["numero_parte"]),
      FIELD_LIMITS.partNumber
    );
    validateLength(validationErrors, rowNumber, "unidad", nullableText(row["unidad"]), FIELD_LIMITS.unit);
    validateLength(validationErrors, rowNumber, "categoria", nullableText(row["categoria"]), FIELD_LIMITS.category);
    validateLength(
      validationErrors,
      rowNumber,
      "ubicacion",
      storageLocation,
      FIELD_LIMITS.storageLocation
    );

    if (!itemCode || !description || !itemGroup || !warehouseCodeRaw || quantity.value === null) {
      skippedRows.push({
        rowNumber,
        reason: "Fila incompleta o invalida",
        blocking: true,
        itemCode: itemCode || null,
        warehouseCode: warehouseCodeRaw || null,
        projectCode: projectCodeRaw || null,
      });
      return;
    }

    parsedRows.push({
      rowNumber,
      itemCode,
      description,
      itemGroup,
      unit: nullableText(row["unidad"]),
      category: nullableText(row["categoria"]),
      brand: nullableText(row["marca"]),
      partNumber: nullableText(row["numero_parte"]),
      warehouseCodeRaw,
      warehouseKey: normalizeWarehouseKey(warehouseCodeRaw),
      projectCodeRaw,
      projectKey: normalizeProjectKey(projectCodeRaw),
      bodegaCodeRaw,
      quantity: quantity.value,
      minimumStock: minimumStock.value,
      storageLocation,
      isActive: enabled.value,
    });
  });

  return { parsedRows, skippedRows, validationErrors };
}

function variantKey(value: unknown) {
  return normalizeCell(value).toUpperCase();
}

function chooseVariant(
  rows: ParsedProductInventoryRow[],
  field: keyof ParsedProductInventoryRow,
  includeEmpty = false
) {
  const variants = new Map<string, Variant & { raw: unknown }>();
  for (const row of rows) {
    const raw = row[field];
    const normalized = normalizeCell(raw);
    if (!includeEmpty && !normalized) continue;
    const key = variantKey(raw);
    const existing = variants.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    variants.set(key, {
      value: normalized,
      count: 1,
      firstRow: row.rowNumber,
      raw,
    });
  }

  const sorted = Array.from(variants.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.firstRow - right.firstRow;
  });

  return {
    value: sorted[0]?.raw ?? null,
    variants: sorted.map(({ value, count, firstRow }) => ({
      value,
      count,
      firstRow,
    })),
  };
}

function collectConflict(
  conflicts: ConflictReport[],
  scope: "catalog" | "inventory",
  key: string,
  field: string,
  rows: ParsedProductInventoryRow[],
  sourceField: keyof ParsedProductInventoryRow
) {
  const chosen = chooseVariant(rows, sourceField);
  if (chosen.variants.length > 1) {
    conflicts.push({ scope, key, field, variants: chosen.variants });
  }
  return chosen.value;
}

export function buildImportData(params: {
  file: string;
  sheetName: string;
  rawRows: number;
  parsedRows: ParsedProductInventoryRow[];
  skippedRows: SkippedRow[];
  validationErrors: string[];
}) {
  const conflicts: ConflictReport[] = [];
  const productRowsByCode = new Map<string, ParsedProductInventoryRow[]>();
  const inventoryRowsByKey = new Map<string, ParsedProductInventoryRow[]>();

  for (const row of params.parsedRows) {
    const productRows = productRowsByCode.get(row.itemCode) ?? [];
    productRows.push(row);
    productRowsByCode.set(row.itemCode, productRows);

    const inventoryKey = `${row.itemCode}::${row.warehouseKey}::${row.projectKey}`;
    const inventoryRows = inventoryRowsByKey.get(inventoryKey) ?? [];
    inventoryRows.push(row);
    inventoryRowsByKey.set(inventoryKey, inventoryRows);
  }

  const products = Array.from(productRowsByCode.entries()).map(
    ([itemCode, rows]) => ({
      itemCode,
      description: String(
        collectConflict(conflicts, "catalog", itemCode, "description", rows, "description")
      ),
      itemGroup: collectConflict(conflicts, "catalog", itemCode, "itemGroup", rows, "itemGroup") as string,
      brand: collectConflict(conflicts, "catalog", itemCode, "brand", rows, "brand") as string | null,
      partNumber: collectConflict(conflicts, "catalog", itemCode, "partNumber", rows, "partNumber") as string | null,
      isActive: rows.some(row => row.isActive),
      sourceRows: rows.map(row => row.rowNumber),
    })
  );

  const inventory = Array.from(inventoryRowsByKey.entries()).map(
    ([key, rows]) => {
      const first = rows[0];
      const storageLocation = collectConflict(
        conflicts,
        "inventory",
        key,
        "storageLocation",
        rows,
        "storageLocation"
      ) as string | null;
      const minimumStock = chooseVariant(rows, "minimumStock").value as number | null;

      return {
        key,
        sapItemCode: first.itemCode,
        warehouseCodeRaw: first.warehouseCodeRaw,
        warehouseKey: first.warehouseKey,
        projectCodeRaw: first.projectCodeRaw,
        projectKey: first.projectKey,
        name: first.description,
        description: first.description,
        unit: collectConflict(conflicts, "inventory", key, "unit", rows, "unit") as string | null,
        category: collectConflict(conflicts, "inventory", key, "category", rows, "category") as string | null,
        currentStock: rows.reduce((sum, row) => sum + row.quantity, 0),
        minimumStock,
        storageLocation,
        isActive: rows.some(row => row.isActive),
        sourceRows: rows.map(row => row.rowNumber),
      } satisfies InventoryInput;
    }
  );

  return {
    file: params.file,
    sheetName: params.sheetName,
    rawRows: params.rawRows,
    parsedRows: params.parsedRows,
    skippedRows: params.skippedRows,
    products,
    inventory,
    conflicts,
    validationErrors: params.validationErrors,
  } satisfies ImportData;
}

export function buildProjectLookup(projects: DbProject[]) {
  const byExact = new Map<string, DbProject>();
  const byKey = new Map<string, DbProject>();
  for (const project of projects) {
    const candidates = [project.code, project.sapProjectCode].filter(Boolean) as string[];
    for (const candidate of candidates) {
      byExact.set(normalizeUpper(candidate), project);
      const key = normalizeProjectKey(candidate);
      if (!byKey.has(key)) byKey.set(key, project);
    }
  }
  return { byExact, byKey };
}

export function buildWarehouseLookup(warehouses: DbWarehouse[]) {
  const byExact = new Map<string, DbWarehouse>();
  const byKey = new Map<string, DbWarehouse>();
  for (const warehouse of warehouses) {
    const candidates = [warehouse.code, warehouse.localCode].filter(Boolean) as string[];
    for (const candidate of candidates) {
      byExact.set(normalizeUpper(candidate), warehouse);
      const key = normalizeWarehouseKey(candidate);
      if (!byKey.has(key)) byKey.set(key, warehouse);
    }
  }
  return { byExact, byKey };
}

function resolveProject(projectCode: string, relations: Relations) {
  return (
    relations.projectsByExactCode.get(normalizeUpper(projectCode)) ??
    relations.projectsByKey.get(normalizeProjectKey(projectCode)) ??
    null
  );
}

function resolveWarehouse(warehouseCode: string, relations: Relations) {
  return (
    relations.warehousesByExactCode.get(normalizeUpper(warehouseCode)) ??
    relations.warehousesByKey.get(normalizeWarehouseKey(warehouseCode)) ??
    null
  );
}

function collectMissingProjects(inventory: InventoryInput[], relations: Relations) {
  const missing = new Map<string, MissingProject>();
  for (const item of inventory) {
    if (resolveProject(item.projectCodeRaw, relations)) continue;
    const existing = missing.get(item.projectKey) ?? {
      projectCode: item.projectCodeRaw,
      projectKey: item.projectKey,
      rows: [],
    };
    existing.rows.push(...item.sourceRows);
    missing.set(item.projectKey, existing);
  }
  return Array.from(missing.values());
}

function collectMissingWarehouses(inventory: InventoryInput[], relations: Relations) {
  const missing = new Map<string, MissingWarehouse>();
  for (const item of inventory) {
    if (resolveWarehouse(item.warehouseCodeRaw, relations)) continue;
    const existing = missing.get(item.warehouseKey) ?? {
      warehouseCode: item.warehouseCodeRaw,
      warehouseKey: item.warehouseKey,
      rows: [],
    };
    existing.rows.push(...item.sourceRows);
    missing.set(item.warehouseKey, existing);
  }
  return Array.from(missing.values());
}

function resolveInventoryRows(inventory: InventoryInput[], relations: Relations) {
  const resolved: ResolvedInventoryInput[] = [];
  const missingAssignmentsByKey = new Map<string, MissingAssignment>();

  for (const item of inventory) {
    const project = resolveProject(item.projectCodeRaw, relations);
    const warehouse = resolveWarehouse(item.warehouseCodeRaw, relations);
    if (!project || !warehouse) continue;

    const assignmentKey = `${project.id}::${warehouse.id}`;
    if (!relations.assignmentKeys.has(assignmentKey)) {
      const missing = missingAssignmentsByKey.get(assignmentKey) ?? {
        projectId: project.id,
        projectCode: project.code,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        rows: [],
      };
      missing.rows.push(...item.sourceRows);
      missingAssignmentsByKey.set(assignmentKey, missing);
      continue;
    }

    resolved.push({
      ...item,
      project,
      warehouse,
      projectId: project.id,
      warehouseId: warehouse.id,
      warehouseLocation: warehouse.displayName,
    });
  }

  return {
    resolved,
    missingAssignments: Array.from(missingAssignmentsByKey.values()),
  };
}

function inventoryDbKey(
  sapItemCode: string,
  projectId: number | null,
  warehouseId: number | null
) {
  return `${sapItemCode}::${projectId ?? "null"}::${warehouseId ?? "null"}`;
}

export function buildPlan(params: {
  data: ImportData;
  resolvedInventory: ResolvedInventoryInput[];
  existingCatalogRows: ExistingCatalogRow[];
  existingInventoryRows: ExistingInventoryRow[];
}) {
  const existingCatalogByCode = new Map(
    params.existingCatalogRows.map(row => [row.itemCode, row])
  );
  const catalogInserts: CatalogWrite[] = [];
  const catalogUpdates: CatalogWrite[] = [];
  const existingAssetConflicts: ExistingCatalogRow[] = [];

  for (const product of params.data.products) {
    const existing = existingCatalogByCode.get(product.itemCode);
    if (existing?.tipoArticulo === 3) {
      existingAssetConflicts.push(existing);
      continue;
    }

    const write: CatalogWrite = {
      ...product,
      tipoArticulo: PRODUCT_ARTICLE_TYPE,
      existing,
    };
    if (existing) catalogUpdates.push(write);
    else catalogInserts.push(write);
  }

  const existingInventoryByKey = new Map<string, ExistingInventoryRow>();
  let existingDuplicateKeys = 0;
  for (const row of params.existingInventoryRows) {
    const key = inventoryDbKey(row.sapItemCode, row.projectId, row.warehouseId);
    if (existingInventoryByKey.has(key)) {
      existingDuplicateKeys += 1;
      continue;
    }
    existingInventoryByKey.set(key, row);
  }

  const inventoryInserts: InventoryWrite[] = [];
  const inventoryUpdates: InventoryWrite[] = [];
  for (const item of params.resolvedInventory) {
    const existing = existingInventoryByKey.get(
      inventoryDbKey(item.sapItemCode, item.projectId, item.warehouseId)
    );
    const write: InventoryWrite = {
      ...item,
      id: existing?.id,
      existing,
      storageLocationForDb: item.storageLocation ?? existing?.storageLocation ?? null,
    };
    if (existing) inventoryUpdates.push(write);
    else inventoryInserts.push(write);
  }

  return {
    catalog: {
      inserts: catalogInserts,
      updates: catalogUpdates,
      existingAssetConflicts,
    },
    inventory: {
      inserts: inventoryInserts,
      updates: inventoryUpdates,
      existingDuplicateKeys,
    },
  } satisfies ImportPlan;
}

function requireDatabaseUrl() {
  dotenv.config({ path: ".env" });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no esta configurado en .env");
  }
  return connectionString;
}

async function loadRelations(client: Client): Promise<Relations> {
  const projectsResult = await client.query<DbProject>(
    `select id, code, "sapProjectCode", name, status
       from projects
      where status = 'activo'`
  );
  const warehousesResult = await client.query<DbWarehouse>(
    `select id, code, "localCode", name, "displayName", "isActive"
       from warehouses
      where "isActive" = true`
  );
  const assignmentsResult = await client.query<{
    projectId: number;
    warehouseId: number;
  }>(`select "projectId", "warehouseId" from "projectWarehouseAssignments"`);

  const projectLookup = buildProjectLookup(projectsResult.rows);
  const warehouseLookup = buildWarehouseLookup(warehousesResult.rows);
  return {
    projectsByExactCode: projectLookup.byExact,
    projectsByKey: projectLookup.byKey,
    warehousesByExactCode: warehouseLookup.byExact,
    warehousesByKey: warehouseLookup.byKey,
    assignmentKeys: new Set(
      assignmentsResult.rows.map(row => `${row.projectId}::${row.warehouseId}`)
    ),
  };
}

async function loadExistingCatalogRows(client: Client, itemCodes: string[]) {
  const rows: ExistingCatalogRow[] = [];
  for (const chunk of chunkItems(Array.from(new Set(itemCodes)), BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingCatalogRow>(
      `select id,
              "itemCode",
              description,
              "itemGroup",
              brand,
              "partNumber",
              "tipoArticulo",
              "isActive"
         from "sapCatalog"
        where "itemCode" = any($1::text[])`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return rows;
}

async function loadExistingInventoryRows(client: Client, itemCodes: string[]) {
  const rows: ExistingInventoryRow[] = [];
  for (const chunk of chunkItems(Array.from(new Set(itemCodes)), BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingInventoryRow>(
      `select id,
              "sapItemCode",
              "projectId",
              "warehouseId",
              "storageLocation"
         from "inventoryItems"
        where "sapItemCode" = any($1::text[])`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return rows;
}

function toCatalogPayload(rows: CatalogWrite[]) {
  return rows.map(row => ({
    itemCode: row.itemCode,
    description: row.description,
    itemGroup: row.itemGroup,
    brand: row.brand,
    partNumber: row.partNumber,
    tipoArticulo: row.tipoArticulo,
    isActive: row.isActive,
  }));
}

async function upsertCatalogProducts(client: Client, rows: CatalogWrite[]) {
  let affected = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `insert into "sapCatalog"
        (
          "itemCode",
          description,
          "itemGroup",
          brand,
          "partNumber",
          "tipoArticulo",
          "projectId",
          "isActive",
          "updatedAt"
        )
       select x."itemCode",
              x.description,
              x."itemGroup",
              x.brand,
              x."partNumber",
              x."tipoArticulo",
              null,
              x."isActive",
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "itemCode" text,
           description text,
           "itemGroup" text,
           brand text,
           "partNumber" text,
           "tipoArticulo" integer,
           "isActive" boolean
         )
       on conflict ("itemCode") do update set
          description = excluded.description,
          "itemGroup" = coalesce(excluded."itemGroup", "sapCatalog"."itemGroup"),
          brand = coalesce(excluded.brand, "sapCatalog".brand),
          "partNumber" = coalesce(excluded."partNumber", "sapCatalog"."partNumber"),
          "tipoArticulo" = ${PRODUCT_ARTICLE_TYPE},
          "projectId" = null,
          "isActive" = excluded."isActive",
          "updatedAt" = now()`,
      [JSON.stringify(toCatalogPayload(chunk))]
    );
    affected += chunk.length;
  }
  return affected;
}

function toInventoryPayload(rows: InventoryWrite[]) {
  return rows.map(row => ({
    id: row.id ?? null,
    sapItemCode: row.sapItemCode,
    name: row.name,
    description: row.description,
    unit: row.unit,
    category: row.category,
    currentStock: formatDecimal(row.currentStock),
    minimumStock:
      row.minimumStock === null || row.minimumStock === undefined
        ? null
        : formatDecimal(row.minimumStock),
    projectId: row.projectId,
    warehouseId: row.warehouseId,
    warehouseLocation: row.warehouseLocation,
    storageLocation: row.storageLocationForDb,
    isActive: row.isActive,
  }));
}

async function updateInventoryRows(client: Client, rows: InventoryWrite[]) {
  let updated = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `update "inventoryItems" as item
          set "sapItemCode" = x."sapItemCode",
              name = x.name,
              description = x.description,
              unit = x.unit,
              category = x.category,
              "currentStock" = x."currentStock"::numeric,
              "minimumStock" = case
                when x."minimumStock" is null then null
                else x."minimumStock"::numeric
              end,
              "projectId" = x."projectId",
              "warehouseId" = x."warehouseId",
              "warehouseLocation" = x."warehouseLocation",
              "storageLocation" = case
                when x."storageLocation" is null then item."storageLocation"
                else x."storageLocation"
              end,
              "isActive" = x."isActive",
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           "sapItemCode" text,
           name text,
           description text,
           unit text,
           category text,
           "currentStock" text,
           "minimumStock" text,
           "projectId" integer,
           "warehouseId" integer,
           "warehouseLocation" text,
           "storageLocation" text,
           "isActive" boolean
         )
        where item.id = x.id`,
      [JSON.stringify(toInventoryPayload(chunk))]
    );
    updated += chunk.length;
  }
  return updated;
}

async function insertInventoryRows(client: Client, rows: InventoryWrite[]) {
  let inserted = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `insert into "inventoryItems"
        (
          "sapItemCode",
          name,
          description,
          unit,
          category,
          "currentStock",
          "minimumStock",
          "projectId",
          "warehouseId",
          "warehouseLocation",
          "storageLocation",
          "isActive",
          "updatedAt"
        )
       select x."sapItemCode",
              x.name,
              x.description,
              x.unit,
              x.category,
              x."currentStock"::numeric,
              case
                when x."minimumStock" is null then null
                else x."minimumStock"::numeric
              end,
              x."projectId",
              x."warehouseId",
              x."warehouseLocation",
              x."storageLocation",
              x."isActive",
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "sapItemCode" text,
           name text,
           description text,
           unit text,
           category text,
           "currentStock" text,
           "minimumStock" text,
           "projectId" integer,
           "warehouseId" integer,
           "warehouseLocation" text,
           "storageLocation" text,
           "isActive" boolean
         )`,
      [JSON.stringify(toInventoryPayload(chunk))]
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function applyPlan(client: Client, plan: ImportPlan) {
  await client.query("begin");
  try {
    const catalogInserted = await upsertCatalogProducts(client, plan.catalog.inserts);
    const catalogUpdated = await upsertCatalogProducts(client, plan.catalog.updates);
    const inventoryUpdated = await updateInventoryRows(client, plan.inventory.updates);
    const inventoryInserted = await insertInventoryRows(client, plan.inventory.inserts);
    await client.query("commit");
    return {
      catalog: {
        inserted: catalogInserted,
        updated: catalogUpdated,
      },
      inventory: {
        inserted: inventoryInserted,
        updated: inventoryUpdated,
      },
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function countScalar(client: Client, sqlText: string, params: unknown[] = []) {
  const result = await client.query<{ count: number }>(sqlText, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyImport(params: {
  client: Client;
  data: ImportData;
  plan: ImportPlan;
}) {
  const itemCodes = params.data.products.map(product => product.itemCode);
  const inventoryKeys = [...params.plan.inventory.inserts, ...params.plan.inventory.updates].map(
    row => ({
      sapItemCode: row.sapItemCode,
      projectId: row.projectId,
      warehouseId: row.warehouseId,
    })
  );
  const projectIds = Array.from(
    new Set(inventoryKeys.map(row => row.projectId).filter(Boolean))
  );
  const warehouseIds = Array.from(
    new Set(inventoryKeys.map(row => row.warehouseId).filter(Boolean))
  );
  const expectedTotalStock = formatDecimal(
    params.data.inventory.reduce((sum, item) => sum + item.currentStock, 0)
  );
  const expectedStorageLocationRows = params.data.inventory.filter(
    item => item.storageLocation
  ).length;

  const assetsTotal = await countScalar(
    params.client,
    `select count(*)::int as count from "sapCatalog" where "tipoArticulo" = 3`
  );
  const assetsActive = await countScalar(
    params.client,
    `select count(*)::int as count
       from "sapCatalog"
      where "tipoArticulo" = 3
        and "isActive" = true`
  );
  const importedCodesFound = await countScalar(
    params.client,
    `select count(*)::int as count
       from "sapCatalog"
      where "itemCode" = any($1::text[])`,
    [itemCodes]
  );
  const importedCodesTipoArticulo1 = await countScalar(
    params.client,
    `select count(*)::int as count
       from "sapCatalog"
      where "itemCode" = any($1::text[])
        and "tipoArticulo" = ${PRODUCT_ARTICLE_TYPE}`,
    [itemCodes]
  );
  const totalTipoArticulo1 = await countScalar(
    params.client,
    `select count(*)::int as count
       from "sapCatalog"
      where "tipoArticulo" = ${PRODUCT_ARTICLE_TYPE}`
  );

  const inventoryRowsResult = await params.client.query<{
    rows: number;
    totalStock: string;
    storageLocationRows: number;
    nonProductRows: number;
  }>(
    `select count(inv.id)::int as rows,
            coalesce(sum(inv."currentStock"), 0)::text as "totalStock",
            count(inv.id) filter (
              where inv."storageLocation" is not null
                and btrim(inv."storageLocation") <> ''
            )::int as "storageLocationRows",
            count(inv.id) filter (
              where cat."tipoArticulo" is distinct from ${PRODUCT_ARTICLE_TYPE}
            )::int as "nonProductRows"
       from "inventoryItems" inv
       left join "sapCatalog" cat on cat."itemCode" = inv."sapItemCode"
      where inv."sapItemCode" = any($1::text[])
        and inv."projectId" = any($2::int[])
        and inv."warehouseId" = any($3::int[])`,
    [itemCodes, projectIds, warehouseIds]
  );

  const rowsOutsideExpectedScope = await countScalar(
    params.client,
    `select count(*)::int as count
       from "inventoryItems" inv
      where inv."sapItemCode" = any($1::text[])
        and (
          inv."projectId" is null
          or inv."warehouseId" is null
          or inv."projectId" <> all($2::int[])
          or inv."warehouseId" <> all($3::int[])
        )`,
    [itemCodes, projectIds, warehouseIds]
  );

  const inventoryRow = inventoryRowsResult.rows[0];
  return {
    assets: {
      total: assetsTotal,
      active: assetsActive,
    },
    products: {
      expectedCodes: itemCodes.length,
      importedCodesFound,
      importedCodesTipoArticulo1,
      totalTipoArticulo1,
    },
    inventory: {
      expectedGroups: params.data.inventory.length,
      importedRowsFound: Number(inventoryRow?.rows ?? 0),
      totalStock: formatDecimal(Number(inventoryRow?.totalStock ?? 0)),
      expectedTotalStock,
      nonProductInventoryRows: Number(inventoryRow?.nonProductRows ?? 0),
      rowsOutsideExpectedScope,
      storageLocationRows: Number(inventoryRow?.storageLocationRows ?? 0),
      expectedStorageLocationRows,
    },
  } satisfies VerificationResult;
}

function validateReportForApply(params: {
  data: ImportData;
  missingProjects: MissingProject[];
  missingWarehouses: MissingWarehouse[];
  missingAssignments: MissingAssignment[];
  plan: ImportPlan;
}) {
  const errors = [
    ...params.data.validationErrors,
    ...params.data.skippedRows
      .filter(row => row.blocking)
      .map(row => `Fila ${row.rowNumber}: ${row.reason}`),
  ];
  if (params.missingProjects.length > 0) {
    errors.push(`${params.missingProjects.length} proyectos/bodegas sin empatar`);
  }
  if (params.missingWarehouses.length > 0) {
    errors.push(`${params.missingWarehouses.length} almacenes fisicos sin empatar`);
  }
  if (params.missingAssignments.length > 0) {
    errors.push(`${params.missingAssignments.length} relaciones proyecto-almacen sin empatar`);
  }
  if (params.plan.catalog.existingAssetConflicts.length > 0) {
    errors.push(
      `${params.plan.catalog.existingAssetConflicts.length} codigos ya existen como activos fijos`
    );
  }

  return errors;
}

function buildReport(params: {
  mode: Mode;
  file: string;
  sheetName: string;
  availableSheets: string[];
  rawRows: number;
  unmappedColumns: string[];
  data: ImportData;
  missingProjects: MissingProject[];
  missingWarehouses: MissingWarehouse[];
  missingAssignments: MissingAssignment[];
  plan: ImportPlan;
  applyResult?: ImportReport["applyResult"];
  verification?: VerificationResult;
}) {
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
      parsedRows: params.data.parsedRows.length,
      uniqueProductCodes: params.data.products.length,
      inventoryGroups: params.data.inventory.length,
      totalStock: formatDecimal(
        params.data.inventory.reduce((sum, item) => sum + item.currentStock, 0)
      ),
      storageLocationGroups: params.data.inventory.filter(
        item => item.storageLocation
      ).length,
      skippedRows: params.data.skippedRows.length,
      blockingSkippedRows: params.data.skippedRows.filter(row => row.blocking).length,
      validationErrors: params.data.validationErrors.length,
      conflicts: params.data.conflicts.length,
      missingProjects: params.missingProjects.length,
      missingWarehouses: params.missingWarehouses.length,
      missingAssignments: params.missingAssignments.length,
      existingAssetConflicts: params.plan.catalog.existingAssetConflicts.length,
      catalog: {
        inserts: params.plan.catalog.inserts.length,
        updates: params.plan.catalog.updates.length,
      },
      inventory: {
        inserts: params.plan.inventory.inserts.length,
        updates: params.plan.inventory.updates.length,
        existingDuplicateKeys: params.plan.inventory.existingDuplicateKeys,
      },
    },
    skippedRows: params.data.skippedRows,
    conflicts: params.data.conflicts,
    validationErrors: params.data.validationErrors,
    missingProjects: params.missingProjects,
    missingWarehouses: params.missingWarehouses,
    missingAssignments: params.missingAssignments,
    existingAssetConflicts: params.plan.catalog.existingAssetConflicts,
    catalogInserts: params.plan.catalog.inserts,
    catalogUpdates: params.plan.catalog.updates,
    inventoryInserts: params.plan.inventory.inserts,
    inventoryUpdates: params.plan.inventory.updates,
    applyResult: params.applyResult,
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
  console.log(`Productos unicos: ${report.summary.uniqueProductCodes}`);
  console.log(`Grupos inventario: ${report.summary.inventoryGroups}`);
  console.log(`Stock total: ${report.summary.totalStock}`);
  console.log(`Ubicaciones cargables: ${report.summary.storageLocationGroups}`);
  console.log(`Catalogo a insertar: ${report.summary.catalog.inserts}`);
  console.log(`Catalogo a actualizar: ${report.summary.catalog.updates}`);
  console.log(`Inventario a insertar: ${report.summary.inventory.inserts}`);
  console.log(`Inventario a actualizar: ${report.summary.inventory.updates}`);
  console.log(`Validaciones: ${report.summary.validationErrors}`);
  console.log(`Proyectos faltantes: ${report.summary.missingProjects}`);
  console.log(`Almacenes faltantes: ${report.summary.missingWarehouses}`);
  console.log(`Asignaciones faltantes: ${report.summary.missingAssignments}`);
  console.log(`Conflictos con activos: ${report.summary.existingAssetConflicts}`);
  if (report.applyResult) {
    console.log(`Catalogo insertado: ${report.applyResult.catalog.inserted}`);
    console.log(`Catalogo actualizado: ${report.applyResult.catalog.updated}`);
    console.log(`Inventario insertado: ${report.applyResult.inventory.inserted}`);
    console.log(`Inventario actualizado: ${report.applyResult.inventory.updated}`);
  }
  if (report.verification) {
    console.log(
      `Verificacion productos tipo 1: ${report.verification.products.importedCodesTipoArticulo1}/${report.verification.products.expectedCodes}`
    );
    console.log(
      `Verificacion inventario: ${report.verification.inventory.importedRowsFound}/${report.verification.inventory.expectedGroups}`
    );
    console.log(
      `Verificacion stock: ${report.verification.inventory.totalStock}`
    );
  }
}

async function run(options: CliOptions) {
  const workbook = readWorkbook(options.file, options.sheetName);
  const parsed = parseRows(workbook.rawRows, {
    missingHeaders: workbook.missingHeaders,
  });
  const data = buildImportData({
    file: options.file,
    sheetName: workbook.sheetName,
    rawRows: workbook.rawRows.length,
    parsedRows: parsed.parsedRows,
    skippedRows: parsed.skippedRows,
    validationErrors: parsed.validationErrors,
  });

  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    const relations = await loadRelations(client);
    const missingProjects = collectMissingProjects(data.inventory, relations);
    const missingWarehouses = collectMissingWarehouses(data.inventory, relations);
    const resolvedInventoryResult = resolveInventoryRows(data.inventory, relations);
    const existingCatalogRows = await loadExistingCatalogRows(
      client,
      data.products.map(product => product.itemCode)
    );
    const existingInventoryRows = await loadExistingInventoryRows(
      client,
      data.inventory.map(item => item.sapItemCode)
    );
    const plan = buildPlan({
      data,
      resolvedInventory: resolvedInventoryResult.resolved,
      existingCatalogRows,
      existingInventoryRows,
    });
    const blockingErrors = validateReportForApply({
      data,
      missingProjects,
      missingWarehouses,
      missingAssignments: resolvedInventoryResult.missingAssignments,
      plan,
    });

    let applyResult: ImportReport["applyResult"] | undefined;
    let verification: VerificationResult | undefined;

    if (options.mode === "apply") {
      if (blockingErrors.length > 0) {
        throw new Error(
          `No se puede aplicar la carga por errores bloqueantes:\n${blockingErrors
            .slice(0, 20)
            .join("\n")}`
        );
      }
      applyResult = await applyPlan(client, plan);
      verification = await verifyImport({ client, data, plan });
    }

    const report = buildReport({
      mode: options.mode,
      file: options.file,
      sheetName: workbook.sheetName,
      availableSheets: workbook.availableSheets,
      rawRows: workbook.rawRows.length,
      unmappedColumns: workbook.unmappedColumns,
      data,
      missingProjects,
      missingWarehouses,
      missingAssignments: resolvedInventoryResult.missingAssignments,
      plan,
      applyResult,
      verification,
    });

    await writeReport(options.report, report);
    printSummary(report);
    if (options.report) console.log(`Reporte: ${options.report}`);
    if (options.mode === "dry-run" && blockingErrors.length > 0) {
      console.log("El dry-run encontro errores bloqueantes para apply.");
    }
    return report;
  } finally {
    await client.end();
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  run(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
