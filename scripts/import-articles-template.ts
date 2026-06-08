import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const SHEET_NAME = "ARTICULOS";
const BATCH_SIZE = 500;

const EXPECTED_HEADERS = [
  "Codigo Proyecto",
  "Nombre Proyecto",
  "Codigo de almacen",
  "Nombre de almacen",
  "Numero de articulo",
  "Tipo de articulo",
  "Grupo SAP",
  "Descripcion del articulo",
  "Descripcion del articulo completa",
  "Unidad",
  "Categoria inventario",
  "En stock",
  "Stock minimo",
  "Permite retencion",
  "Activo",
  "Serie activo fijo",
  "Condicion activo fijo",
  "Color activo fijo",
  "Modelo activo fijo",
  "Marca activo fijo",
  "Serie chasis",
  "Serie motor",
  "Placa o codigo",
  "Es leasing",
  "Observacion activo fijo",
] as const;

const OPTIONAL_HEADERS = ["Marca", "Numero de parte"] as const;

const FIELD_LIMITS = {
  itemCode: 50,
  description: 500,
  itemGroup: 255,
  brand: 120,
  partNumber: 120,
  unit: 50,
  category: 100,
  projectCode: 50,
  projectName: 255,
  warehouseLocalCode: 20,
  warehouseName: 255,
  warehouseDisplayName: 300,
  fixedAssetSerialNumber: 120,
  fixedAssetColor: 120,
  fixedAssetModel: 120,
  fixedAssetBrand: 120,
  fixedAssetChassisSeries: 120,
  fixedAssetMotorSeries: 120,
  fixedAssetPlateOrCode: 120,
} as const;

const ARTICLE_TYPE_LABELS = {
  ARTICULO: 1,
  SERVICIO: 2,
  ACTIVO: 3,
  "ACTIVO FIJO": 3,
} as const;

const CONDITION_LABELS = {
  NUEVO: "nuevo",
  "USADO BUEN ESTADO": "usado_buen_estado",
  DEFECTUOSO: "defectuoso",
  DANADO: "danado",
  "DANADO/DANIADO": "danado",
} as const;

type ArticleType = 1 | 2 | 3;
type AssetCondition = (typeof CONDITION_LABELS)[keyof typeof CONDITION_LABELS];
type HeaderName =
  | (typeof EXPECTED_HEADERS)[number]
  | (typeof OPTIONAL_HEADERS)[number];
type ExcelRow = Record<string, unknown>;

type CliOptions = {
  file: string;
  report?: string;
  mode: "dry-run" | "apply";
};

type ParsedSheetRow = {
  rowNumber: number;
  projectCode: string;
  projectName: string;
  warehouseLocalCode: string;
  warehouseName: string;
  itemCode: string;
  tipoArticulo: ArticleType;
  typeLabel: string;
  itemGroup: string;
  brand: string;
  partNumber: string;
  shortDescription: string;
  fullDescription: string;
  unit: string;
  category: string;
  stock: number;
  minimumStock: number | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
  fixedAssetSerialNumber: string;
  fixedAssetCondition: AssetCondition | null;
  fixedAssetColor: string;
  fixedAssetModel: string;
  fixedAssetBrand: string;
  fixedAssetChassisSeries: string;
  fixedAssetMotorSeries: string;
  fixedAssetPlateOrCode: string;
  fixedAssetIsLeasing: boolean;
  fixedAssetObservation: string;
};

type Variant = {
  value: string;
  count: number;
  firstRow: number;
};

type ConflictReport = {
  scope: "catalog" | "inventory" | "project" | "warehouse";
  key: string;
  field: string;
  variants: Variant[];
};

type SkippedRow = {
  rowNumber: number;
  reason: string;
  projectCode?: string;
  description?: string;
};

type ProjectInput = {
  code: string;
  name: string;
  sourceRows: number[];
};

type WarehouseInput = {
  projectCode: string;
  localCode: string;
  localKey: string;
  name: string;
  sourceRows: number[];
};

type CatalogInput = {
  itemCode: string;
  description: string;
  itemGroup: string | null;
  brand: string | null;
  partNumber: string | null;
  tipoArticulo: ArticleType;
  projectCode: string | null;
  unit: string | null;
  category: string | null;
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
  allowsTaxWithholding: boolean;
  isActive: boolean;
  sourceRows: number[];
};

type InventoryInput = {
  key: string;
  sapItemCode: string;
  projectCode: string;
  warehouseLocalCode: string;
  warehouseLocalKey: string;
  name: string;
  description: string | null;
  unit: string | null;
  category: string | null;
  currentStock: number;
  minimumStock: number | null;
  isActive: boolean;
  sourceRows: number[];
};

type ImportData = {
  file: string;
  sheetName: string;
  rawRows: number;
  parsedRows: ParsedSheetRow[];
  skippedRows: SkippedRow[];
  projects: ProjectInput[];
  warehouses: WarehouseInput[];
  catalog: CatalogInput[];
  inventory: InventoryInput[];
  conflicts: ConflictReport[];
  validationErrors: string[];
};

type DbProject = {
  id: number;
  code: string;
  name: string;
};

type DbWarehouse = {
  id: number;
  code: string;
  localCode: string | null;
  name: string;
  displayName: string;
  projectId: number | null;
  isDefault: boolean;
};

type ResolvedRelations = {
  projectsByCode: Map<string, DbProject>;
  warehousesByInputKey: Map<string, DbWarehouse>;
  missingProjectCodes: string[];
  missingWarehouseKeys: string[];
};

type ApplyResult = {
  projects: {
    existing: number;
    inserted: number;
  };
  warehouses: {
    existing: number;
    inserted: number;
  };
  catalog: {
    inserted: number;
    updated: number;
  };
  inventory: {
    inserted: number;
    updated: number;
    existingDuplicateKeys: number;
  };
};

type VerificationResult = {
  catalogRowsForTemplate: number;
  inventoryRowsForTemplateProjects: number;
  inventoryRowsMissingProjectOrWarehouse: number;
  nonArticleInventoryRows: number;
  catalogByType: Record<string, number>;
  inventoryByProject: Array<{
    projectCode: string;
    rows: number;
    totalStock: string;
  }>;
};

type ImportReport = {
  generatedAt: string;
  mode: "dry-run" | "apply";
  source: {
    file: string;
    sheetName: string;
    rawRows: number;
  };
  summary: {
    parsedRows: number;
    skippedRows: number;
    projects: number;
    warehouses: number;
    catalogItems: number;
    inventoryRows: number;
    catalogByType: Record<string, number>;
  };
  dbPlan: {
    missingProjects: string[];
    missingWarehouses: string[];
    catalog: {
      existing: number;
      toInsert: number;
      toUpdate: number;
    };
    inventory: {
      existing: number;
      toInsert: number;
      toUpdate: number;
      existingDuplicateKeys: number;
    };
  };
  applyResult?: ApplyResult;
  verification?: VerificationResult;
  skippedRows: SkippedRow[];
  conflicts: ConflictReport[];
  validationErrors: string[];
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-articles-template.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-articles-template.ts --file <xlsx> --apply --report <json>",
    ].join("\n")
  );
}

function parseArgs(argv: string[]): CliOptions {
  let file = "";
  let report: string | undefined;
  let mode: CliOptions["mode"] | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      file = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--report") {
      report = argv[index + 1] ?? "";
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

  if (!file) {
    throw new Error("Debe indicar --file <xlsx>");
  }
  if (!mode) {
    throw new Error("Debe indicar --dry-run o --apply");
  }
  if (argv.includes("--dry-run") && argv.includes("--apply")) {
    throw new Error("Use solo uno: --dry-run o --apply");
  }

  return { file, report, mode };
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeWarehouseCode(value: unknown) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FIELD_LIMITS.warehouseLocalCode);
}

function warehouseLocalKey(value: unknown) {
  const normalized = normalizeWarehouseCode(value);
  const withoutLeadingZeroes = normalized.replace(/^0+/, "");
  return withoutLeadingZeroes || normalized || "0";
}

function normalizeWarehouseName(value: unknown) {
  return normalizeText(value);
}

function normalizeProjectName(code: string, name: string) {
  const trimmed = normalizeText(name);
  const prefixPattern = new RegExp(`^${escapeRegExp(code)}\\s*-\\s*`, "i");
  return trimmed.replace(prefixPattern, "").trim() || trimmed || code;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCell(row: ExcelRow, header: HeaderName) {
  return normalizeText(row[header]);
}

function parseBooleanCell(
  value: unknown,
  defaultValue: boolean,
  rowNumber: number,
  fieldName: string,
  errors: string[]
) {
  const normalized = normalizeLookup(value);
  if (!normalized) return defaultValue;
  if (["SI", "S", "YES", "Y", "TRUE", "1"].includes(normalized)) return true;
  if (["NO", "N", "FALSE", "0"].includes(normalized)) return false;

  errors.push(
    `Fila ${rowNumber}: valor booleano invalido en ${fieldName}: ${normalizeText(value)}`
  );
  return defaultValue;
}

function parseNumberCell(
  value: unknown,
  defaultValue: number | null,
  rowNumber: number,
  fieldName: string,
  errors: string[]
) {
  if (value === null || value === undefined || normalizeText(value) === "") {
    return defaultValue;
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    errors.push(`Fila ${rowNumber}: numero invalido en ${fieldName}`);
    return defaultValue;
  }

  const compact = normalizeText(value).replace(/\s+/g, "");
  if (compact === "-" || compact === "--") {
    return defaultValue;
  }
  let normalized = compact;

  if (compact.includes(",") && compact.includes(".")) {
    normalized =
      compact.lastIndexOf(",") > compact.lastIndexOf(".")
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "");
  } else if (compact.includes(",")) {
    const parts = compact.split(",");
    normalized =
      parts.length === 2 && parts[1].length > 0 && parts[1].length <= 4
        ? compact.replace(",", ".")
        : compact.replace(/,/g, "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    errors.push(
      `Fila ${rowNumber}: numero invalido en ${fieldName}: ${normalizeText(value)}`
    );
    return defaultValue;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    errors.push(
      `Fila ${rowNumber}: numero invalido en ${fieldName}: ${normalizeText(value)}`
    );
    return defaultValue;
  }
  return parsed;
}

function parseArticleType(
  value: unknown,
  rowNumber: number,
  errors: string[]
): ArticleType {
  const normalized = normalizeLookup(value);
  const mapped =
    ARTICLE_TYPE_LABELS[normalized as keyof typeof ARTICLE_TYPE_LABELS];
  if (mapped) return mapped;

  errors.push(
    `Fila ${rowNumber}: tipo de articulo invalido: ${normalizeText(value) || "(vacio)"}`
  );
  return 1;
}

function parseAssetCondition(
  value: unknown,
  rowNumber: number,
  errors: string[]
): AssetCondition | null {
  const normalized = normalizeLookup(value);
  if (!normalized) return null;

  const mapped = CONDITION_LABELS[normalized as keyof typeof CONDITION_LABELS];
  if (mapped) return mapped;

  errors.push(
    `Fila ${rowNumber}: condicion de activo fijo invalida: ${normalizeText(value)}`
  );
  return null;
}

function chooseByMajority<T>(
  rows: ParsedSheetRow[],
  getValue: (row: ParsedSheetRow) => T | null | undefined,
  formatValue: (value: T) => string,
  defaultValue: T
) {
  const variants = new Map<string, { value: T; count: number; firstRow: number }>();

  for (const row of rows) {
    const value = getValue(row);
    if (value === null || value === undefined) continue;

    const formatted = formatValue(value);
    if (!formatted) continue;

    const existing = variants.get(formatted);
    if (existing) {
      existing.count += 1;
    } else {
      variants.set(formatted, {
        value,
        count: 1,
        firstRow: row.rowNumber,
      });
    }
  }

  const sorted = Array.from(variants.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.firstRow - b.firstRow;
  });

  return {
    value: sorted[0]?.value ?? defaultValue,
    variants: sorted.map(variant => ({
      value: formatValue(variant.value),
      count: variant.count,
      firstRow: variant.firstRow,
    })),
  };
}

function addConflict(
  conflicts: ConflictReport[],
  scope: ConflictReport["scope"],
  key: string,
  field: string,
  variants: Variant[]
) {
  if (variants.length <= 1) return;
  conflicts.push({
    scope,
    key,
    field,
    variants,
  });
}

function nonEmptyOrNull(value: string) {
  return value.trim() ? value.trim() : null;
}

function toMoneyString(value: number) {
  return value.toFixed(2);
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function readWorkbook(file: string): ImportData {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const worksheet = workbook.Sheets[SHEET_NAME];
  if (!worksheet) {
    throw new Error(`No se encontro la hoja ${SHEET_NAME}`);
  }

  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const actualHeaders = (headerRows[0] ?? []).map(normalizeText);
  const missingHeaders = EXPECTED_HEADERS.filter(
    header => !actualHeaders.includes(header)
  );
  const validationErrors = missingHeaders.map(
    header => `Falta el encabezado requerido: ${header}`
  );

  const rawRows = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, {
    defval: null,
    blankrows: false,
  });

  const parsedRows: ParsedSheetRow[] = [];
  const skippedRows: SkippedRow[] = [];

  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index];
    const rowNumber = index + 2;
    const itemCode = getCell(row, "Numero de articulo");
    const projectCode = getCell(row, "Codigo Proyecto");
    const shortDescription = getCell(row, "Descripcion del articulo");

    if (!itemCode) {
      skippedRows.push({
        rowNumber,
        reason: "Sin Numero de articulo",
        projectCode,
        description: shortDescription,
      });
      continue;
    }

    const tipoArticulo = parseArticleType(
      row["Tipo de articulo"],
      rowNumber,
      validationErrors
    );
    const stock = parseNumberCell(
      row["En stock"],
      0,
      rowNumber,
      "En stock",
      validationErrors
    );
    const minimumStock = parseNumberCell(
      row["Stock minimo"],
      null,
      rowNumber,
      "Stock minimo",
      validationErrors
    );

    if (!shortDescription && !getCell(row, "Descripcion del articulo completa")) {
      validationErrors.push(`Fila ${rowNumber}: falta descripcion del articulo`);
    }

    parsedRows.push({
      rowNumber,
      projectCode,
      projectName: getCell(row, "Nombre Proyecto"),
      warehouseLocalCode: normalizeWarehouseCode(row["Codigo de almacen"]),
      warehouseName: normalizeWarehouseName(row["Nombre de almacen"]),
      itemCode,
      tipoArticulo,
      typeLabel: getCell(row, "Tipo de articulo"),
      itemGroup: getCell(row, "Grupo SAP"),
      brand: getCell(row, "Marca"),
      partNumber: getCell(row, "Numero de parte"),
      shortDescription,
      fullDescription: getCell(row, "Descripcion del articulo completa"),
      unit: getCell(row, "Unidad"),
      category: getCell(row, "Categoria inventario"),
      stock: stock ?? 0,
      minimumStock,
      allowsTaxWithholding: parseBooleanCell(
        row["Permite retencion"],
        true,
        rowNumber,
        "Permite retencion",
        validationErrors
      ),
      isActive: parseBooleanCell(
        row["Activo"],
        true,
        rowNumber,
        "Activo",
        validationErrors
      ),
      fixedAssetSerialNumber: getCell(row, "Serie activo fijo"),
      fixedAssetCondition: parseAssetCondition(
        row["Condicion activo fijo"],
        rowNumber,
        validationErrors
      ),
      fixedAssetColor: getCell(row, "Color activo fijo"),
      fixedAssetModel: getCell(row, "Modelo activo fijo"),
      fixedAssetBrand: getCell(row, "Marca activo fijo"),
      fixedAssetChassisSeries: getCell(row, "Serie chasis"),
      fixedAssetMotorSeries: getCell(row, "Serie motor"),
      fixedAssetPlateOrCode: getCell(row, "Placa o codigo"),
      fixedAssetIsLeasing: parseBooleanCell(
        row["Es leasing"],
        false,
        rowNumber,
        "Es leasing",
        validationErrors
      ),
      fixedAssetObservation: getCell(row, "Observacion activo fijo"),
    });
  }

  const conflicts: ConflictReport[] = [];
  const projects = buildProjects(parsedRows, conflicts);
  const warehouses = buildWarehouses(parsedRows, conflicts);
  const catalog = buildCatalog(parsedRows, conflicts, validationErrors);
  const inventory = buildInventory(parsedRows, conflicts, validationErrors);

  validateLengths(projects, warehouses, catalog, inventory, validationErrors);

  return {
    file,
    sheetName: SHEET_NAME,
    rawRows: rawRows.length,
    parsedRows,
    skippedRows,
    projects,
    warehouses,
    catalog,
    inventory,
    conflicts,
    validationErrors,
  };
}

function buildProjects(rows: ParsedSheetRow[], conflicts: ConflictReport[]) {
  const rowsByProject = new Map<string, ParsedSheetRow[]>();
  for (const row of rows) {
    if (!row.projectCode) continue;
    const group = rowsByProject.get(row.projectCode) ?? [];
    group.push(row);
    rowsByProject.set(row.projectCode, group);
  }

  return Array.from(rowsByProject.entries())
    .map(([code, group]) => {
      const chosenName = chooseByMajority(
        group,
        row => normalizeProjectName(row.projectCode, row.projectName),
        value => value,
        code
      );
      addConflict(conflicts, "project", code, "name", chosenName.variants);

      return {
        code,
        name: chosenName.value,
        sourceRows: group.map(row => row.rowNumber),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

function buildWarehouses(rows: ParsedSheetRow[], conflicts: ConflictReport[]) {
  const rowsByWarehouse = new Map<string, ParsedSheetRow[]>();
  for (const row of rows) {
    if (!row.projectCode || !row.warehouseLocalCode) continue;
    const localKey = warehouseLocalKey(row.warehouseLocalCode);
    const key = `${row.projectCode}::${localKey}`;
    const group = rowsByWarehouse.get(key) ?? [];
    group.push(row);
    rowsByWarehouse.set(key, group);
  }

  return Array.from(rowsByWarehouse.entries())
    .map(([, group]) => {
      const first = group[0];
      const chosenLocalCode = chooseByMajority(
        group,
        row => row.warehouseLocalCode,
        value => value,
        first.warehouseLocalCode
      );
      const chosenName = chooseByMajority(
        group,
        row => row.warehouseName,
        value => value,
        first.warehouseName
      );
      const key = `${first.projectCode}::${warehouseLocalKey(chosenLocalCode.value)}`;
      addConflict(conflicts, "warehouse", key, "localCode", chosenLocalCode.variants);
      addConflict(conflicts, "warehouse", key, "name", chosenName.variants);

      return {
        projectCode: first.projectCode,
        localCode: chosenLocalCode.value,
        localKey: warehouseLocalKey(chosenLocalCode.value),
        name: chosenName.value || chosenLocalCode.value,
        sourceRows: group.map(row => row.rowNumber),
      };
    })
    .sort((a, b) =>
      `${a.projectCode}::${a.localKey}`.localeCompare(`${b.projectCode}::${b.localKey}`)
    );
}

function buildCatalog(
  rows: ParsedSheetRow[],
  conflicts: ConflictReport[],
  validationErrors: string[]
) {
  const rowsByCode = new Map<string, ParsedSheetRow[]>();
  for (const row of rows) {
    const group = rowsByCode.get(row.itemCode) ?? [];
    group.push(row);
    rowsByCode.set(row.itemCode, group);
  }

  return Array.from(rowsByCode.entries())
    .map(([itemCode, group]) => {
      const chosenType = chooseByMajority(
        group,
        row => row.tipoArticulo,
        value => String(value),
        1 as ArticleType
      );
      const chosenShortDescription = chooseByMajority(
        group,
        row => row.shortDescription,
        value => value,
        ""
      );
      const chosenFullDescription = chooseByMajority(
        group,
        row => row.fullDescription,
        value => value,
        ""
      );
      const chosenGroup = chooseByMajority(
        group,
        row => row.itemGroup,
        value => value,
        ""
      );
      const chosenBrand = chooseByMajority(
        group,
        row => row.brand,
        value => value,
        ""
      );
      const chosenPartNumber = chooseByMajority(
        group,
        row => row.partNumber,
        value => value,
        ""
      );
      const chosenUnit = chooseByMajority(group, row => row.unit, value => value, "");
      const chosenCategory = chooseByMajority(
        group,
        row => row.category,
        value => value,
        ""
      );
      const chosenProject = chooseByMajority(
        group,
        row => row.projectCode,
        value => value,
        ""
      );
      const chosenAllowsTax = chooseByMajority(
        group,
        row => row.allowsTaxWithholding,
        value => String(value),
        true
      );
      const chosenActive = chooseByMajority(
        group,
        row => row.isActive,
        value => String(value),
        true
      );

      addConflict(conflicts, "catalog", itemCode, "tipoArticulo", chosenType.variants);
      addConflict(
        conflicts,
        "catalog",
        itemCode,
        "shortDescription",
        chosenShortDescription.variants
      );
      addConflict(
        conflicts,
        "catalog",
        itemCode,
        "fullDescription",
        chosenFullDescription.variants
      );
      addConflict(conflicts, "catalog", itemCode, "itemGroup", chosenGroup.variants);
      addConflict(conflicts, "catalog", itemCode, "brand", chosenBrand.variants);
      addConflict(
        conflicts,
        "catalog",
        itemCode,
        "partNumber",
        chosenPartNumber.variants
      );
      addConflict(conflicts, "catalog", itemCode, "unit", chosenUnit.variants);
      addConflict(conflicts, "catalog", itemCode, "category", chosenCategory.variants);

      if (chosenType.variants.length > 1) {
        validationErrors.push(
          `Articulo ${itemCode}: tiene mas de un Tipo de articulo en la plantilla`
        );
      }
      if (chosenType.value === 3 && chosenProject.variants.length > 1) {
        validationErrors.push(
          `Activo ${itemCode}: aparece asociado a mas de un proyecto`
        );
      }

      const assetFields = chooseAssetFields(group);
      const description =
        chosenShortDescription.value || chosenFullDescription.value || itemCode;

      return {
        itemCode,
        description,
        itemGroup: nonEmptyOrNull(chosenGroup.value),
        brand: nonEmptyOrNull(chosenBrand.value),
        partNumber: nonEmptyOrNull(chosenPartNumber.value),
        tipoArticulo: chosenType.value,
        projectCode: chosenType.value === 3 ? chosenProject.value || null : null,
        unit: nonEmptyOrNull(chosenUnit.value),
        category: nonEmptyOrNull(chosenCategory.value),
        fixedAssetSerialNumber:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.serialNumber.value) : null,
        fixedAssetCondition:
          chosenType.value === 3 ? assetFields.condition.value : null,
        fixedAssetColor:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.color.value) : null,
        fixedAssetModel:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.model.value) : null,
        fixedAssetBrand:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.brand.value) : null,
        fixedAssetChassisSeries:
          chosenType.value === 3
            ? nonEmptyOrNull(assetFields.chassisSeries.value)
            : null,
        fixedAssetMotorSeries:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.motorSeries.value) : null,
        fixedAssetPlateOrCode:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.plateOrCode.value) : null,
        fixedAssetIsLeasing:
          chosenType.value === 3 ? assetFields.isLeasing.value : false,
        fixedAssetObservation:
          chosenType.value === 3 ? nonEmptyOrNull(assetFields.observation.value) : null,
        allowsTaxWithholding: chosenAllowsTax.value,
        isActive: chosenActive.value,
        sourceRows: group.map(row => row.rowNumber),
      };
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

function chooseAssetFields(group: ParsedSheetRow[]) {
  return {
    serialNumber: chooseByMajority(
      group,
      row => row.fixedAssetSerialNumber,
      value => value,
      ""
    ),
    condition: chooseByMajority(
      group,
      row => row.fixedAssetCondition,
      value => value ?? "",
      null
    ),
    color: chooseByMajority(group, row => row.fixedAssetColor, value => value, ""),
    model: chooseByMajority(group, row => row.fixedAssetModel, value => value, ""),
    brand: chooseByMajority(group, row => row.fixedAssetBrand, value => value, ""),
    chassisSeries: chooseByMajority(
      group,
      row => row.fixedAssetChassisSeries,
      value => value,
      ""
    ),
    motorSeries: chooseByMajority(
      group,
      row => row.fixedAssetMotorSeries,
      value => value,
      ""
    ),
    plateOrCode: chooseByMajority(
      group,
      row => row.fixedAssetPlateOrCode,
      value => value,
      ""
    ),
    isLeasing: chooseByMajority(
      group,
      row => row.fixedAssetIsLeasing,
      value => String(value),
      false
    ),
    observation: chooseByMajority(
      group,
      row => row.fixedAssetObservation,
      value => value,
      ""
    ),
  };
}

function buildInventory(
  rows: ParsedSheetRow[],
  conflicts: ConflictReport[],
  validationErrors: string[]
) {
  const rowsByKey = new Map<string, ParsedSheetRow[]>();

  for (const row of rows) {
    if (row.tipoArticulo !== 1) continue;

    if (!row.projectCode) {
      validationErrors.push(
        `Fila ${row.rowNumber}: articulo ${row.itemCode} no tiene Codigo Proyecto`
      );
      continue;
    }
    if (!row.warehouseLocalCode) {
      validationErrors.push(
        `Fila ${row.rowNumber}: articulo ${row.itemCode} no tiene Codigo de almacen`
      );
      continue;
    }

    const key = `${row.projectCode}::${warehouseLocalKey(row.warehouseLocalCode)}::${row.itemCode}`;
    const group = rowsByKey.get(key) ?? [];
    group.push(row);
    rowsByKey.set(key, group);
  }

  return Array.from(rowsByKey.entries())
    .map(([key, group]) => {
      const first = group[0];
      const chosenShortDescription = chooseByMajority(
        group,
        row => row.shortDescription,
        value => value,
        first.shortDescription || first.itemCode
      );
      const chosenFullDescription = chooseByMajority(
        group,
        row => row.fullDescription,
        value => value,
        first.fullDescription
      );
      const chosenUnit = chooseByMajority(group, row => row.unit, value => value, "");
      const chosenCategory = chooseByMajority(
        group,
        row => row.category,
        value => value,
        ""
      );
      const chosenLocalCode = chooseByMajority(
        group,
        row => row.warehouseLocalCode,
        value => value,
        first.warehouseLocalCode
      );
      const chosenMinimumStock = chooseByMajority(
        group,
        row => row.minimumStock,
        value => (value === null ? "" : toMoneyString(value)),
        null
      );
      const chosenActive = chooseByMajority(
        group,
        row => row.isActive,
        value => String(value),
        true
      );

      addConflict(
        conflicts,
        "inventory",
        key,
        "shortDescription",
        chosenShortDescription.variants
      );
      addConflict(
        conflicts,
        "inventory",
        key,
        "fullDescription",
        chosenFullDescription.variants
      );
      addConflict(conflicts, "inventory", key, "unit", chosenUnit.variants);
      addConflict(conflicts, "inventory", key, "category", chosenCategory.variants);
      addConflict(
        conflicts,
        "inventory",
        key,
        "minimumStock",
        chosenMinimumStock.variants
      );

      return {
        key,
        sapItemCode: first.itemCode,
        projectCode: first.projectCode,
        warehouseLocalCode: chosenLocalCode.value,
        warehouseLocalKey: warehouseLocalKey(chosenLocalCode.value),
        name: chosenShortDescription.value || first.itemCode,
        description: nonEmptyOrNull(
          chosenShortDescription.value || chosenFullDescription.value
        ),
        unit: nonEmptyOrNull(chosenUnit.value),
        category: nonEmptyOrNull(chosenCategory.value),
        currentStock: group.reduce((total, row) => total + row.stock, 0),
        minimumStock: chosenMinimumStock.value,
        isActive: chosenActive.value,
        sourceRows: group.map(row => row.rowNumber),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function validateLengths(
  projects: ProjectInput[],
  warehouses: WarehouseInput[],
  catalog: CatalogInput[],
  inventory: InventoryInput[],
  errors: string[]
) {
  for (const project of projects) {
    validateLength(errors, "project", project.code, "code", project.code, FIELD_LIMITS.projectCode);
    validateLength(errors, "project", project.code, "name", project.name, FIELD_LIMITS.projectName);
  }

  for (const warehouse of warehouses) {
    validateLength(
      errors,
      "warehouse",
      `${warehouse.projectCode}::${warehouse.localKey}`,
      "localCode",
      warehouse.localCode,
      FIELD_LIMITS.warehouseLocalCode
    );
    validateLength(
      errors,
      "warehouse",
      `${warehouse.projectCode}::${warehouse.localKey}`,
      "name",
      warehouse.name,
      FIELD_LIMITS.warehouseName
    );
  }

  for (const item of catalog) {
    validateLength(errors, "catalog", item.itemCode, "itemCode", item.itemCode, FIELD_LIMITS.itemCode);
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "description",
      item.description,
      FIELD_LIMITS.description
    );
    validateLength(errors, "catalog", item.itemCode, "itemGroup", item.itemGroup, FIELD_LIMITS.itemGroup);
    validateLength(errors, "catalog", item.itemCode, "brand", item.brand, FIELD_LIMITS.brand);
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "partNumber",
      item.partNumber,
      FIELD_LIMITS.partNumber
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetSerialNumber",
      item.fixedAssetSerialNumber,
      FIELD_LIMITS.fixedAssetSerialNumber
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetColor",
      item.fixedAssetColor,
      FIELD_LIMITS.fixedAssetColor
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetModel",
      item.fixedAssetModel,
      FIELD_LIMITS.fixedAssetModel
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetBrand",
      item.fixedAssetBrand,
      FIELD_LIMITS.fixedAssetBrand
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetChassisSeries",
      item.fixedAssetChassisSeries,
      FIELD_LIMITS.fixedAssetChassisSeries
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetMotorSeries",
      item.fixedAssetMotorSeries,
      FIELD_LIMITS.fixedAssetMotorSeries
    );
    validateLength(
      errors,
      "catalog",
      item.itemCode,
      "fixedAssetPlateOrCode",
      item.fixedAssetPlateOrCode,
      FIELD_LIMITS.fixedAssetPlateOrCode
    );
  }

  for (const item of inventory) {
    validateLength(errors, "inventory", item.key, "sapItemCode", item.sapItemCode, FIELD_LIMITS.itemCode);
    validateLength(errors, "inventory", item.key, "name", item.name, FIELD_LIMITS.description);
    validateLength(errors, "inventory", item.key, "unit", item.unit, FIELD_LIMITS.unit);
    validateLength(errors, "inventory", item.key, "category", item.category, FIELD_LIMITS.category);
  }
}

function validateLength(
  errors: string[],
  scope: string,
  key: string,
  field: string,
  value: string | null,
  limit: number
) {
  if (!value) return;
  if (value.length <= limit) return;
  errors.push(
    `${scope} ${key}: ${field} excede ${limit} caracteres (${value.length})`
  );
}

function catalogByType(catalog: CatalogInput[]) {
  return catalog.reduce<Record<string, number>>((counts, item) => {
    const key =
      item.tipoArticulo === 1
        ? "ARTICULO"
        : item.tipoArticulo === 2
          ? "SERVICIO"
          : "ACTIVO";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function requireDatabaseUrl() {
  dotenv.config({ path: ".env" });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no esta configurado en .env");
  }
  return connectionString;
}

async function loadProjectsByCode(client: Client, projectCodes: string[]) {
  if (projectCodes.length === 0) return new Map<string, DbProject>();
  const result = await client.query<DbProject>(
    `select id, code, name
       from "projects"
      where code = any($1::text[])`,
    [projectCodes]
  );
  return new Map(result.rows.map(row => [row.code, row]));
}

async function loadWarehousesByProjectIds(client: Client, projectIds: number[]) {
  if (projectIds.length === 0) return [] as DbWarehouse[];
  const result = await client.query<DbWarehouse>(
    `select id,
            code,
            "localCode",
            name,
            "displayName",
            "projectId",
            "isDefault"
       from "warehouses"
      where "projectId" = any($1::int[])
      order by "projectId", "localCode", id`,
    [projectIds]
  );
  return result.rows;
}

function findWarehouse(
  warehouses: DbWarehouse[],
  projectId: number,
  localCode: string
) {
  const candidates = warehouses.filter(warehouse => warehouse.projectId === projectId);
  const normalized = normalizeWarehouseCode(localCode);
  const exact = candidates.find(
    warehouse => normalizeWarehouseCode(warehouse.localCode ?? "") === normalized
  );
  if (exact) return exact;

  const local = warehouseLocalKey(localCode);
  return candidates.find(
    warehouse => warehouseLocalKey(warehouse.localCode ?? "") === local
  );
}

async function resolveRelations(
  client: Client,
  data: ImportData
): Promise<ResolvedRelations> {
  const projectCodes = data.projects.map(project => project.code);
  const projectsByCode = await loadProjectsByCode(client, projectCodes);
  const warehouses = await loadWarehousesByProjectIds(
    client,
    Array.from(projectsByCode.values()).map(project => project.id)
  );
  const warehousesByInputKey = new Map<string, DbWarehouse>();
  const missingProjectCodes: string[] = [];
  const missingWarehouseKeys: string[] = [];

  for (const project of data.projects) {
    if (!projectsByCode.has(project.code)) {
      missingProjectCodes.push(project.code);
    }
  }

  for (const input of data.warehouses) {
    const project = projectsByCode.get(input.projectCode);
    const inputKey = warehouseInputKey(input.projectCode, input.localKey);
    if (!project) {
      missingWarehouseKeys.push(inputKey);
      continue;
    }
    const warehouse = findWarehouse(warehouses, project.id, input.localCode);
    if (warehouse) {
      warehousesByInputKey.set(inputKey, warehouse);
    } else {
      missingWarehouseKeys.push(inputKey);
    }
  }

  return {
    projectsByCode,
    warehousesByInputKey,
    missingProjectCodes,
    missingWarehouseKeys,
  };
}

function warehouseInputKey(projectCode: string, localKey: string) {
  return `${projectCode}::${localKey}`;
}

async function buildDbPlan(client: Client, data: ImportData) {
  const relations = await resolveRelations(client, data);
  const existingCatalogCodes = await loadExistingCatalogCodes(
    client,
    data.catalog.map(item => item.itemCode)
  );
  const existingInventory = await loadExistingInventoryRows(
    client,
    data.inventory.map(item => item.sapItemCode)
  );
  const inventoryPlan = planInventoryWrites(data.inventory, relations, existingInventory);

  return {
    relations,
    existingCatalogCodes,
    inventoryPlan,
  };
}

async function loadExistingCatalogCodes(client: Client, itemCodes: string[]) {
  const existing = new Set<string>();
  for (const chunk of chunkItems(itemCodes, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<{ itemCode: string }>(
      `select "itemCode" from "sapCatalog" where "itemCode" = any($1::text[])`,
      [chunk]
    );
    for (const row of result.rows) {
      existing.add(row.itemCode);
    }
  }
  return existing;
}

type ExistingInventoryRow = {
  id: number;
  sapItemCode: string;
  projectId: number | null;
  warehouseId: number | null;
};

async function loadExistingInventoryRows(client: Client, itemCodes: string[]) {
  const rows: ExistingInventoryRow[] = [];
  const uniqueCodes = Array.from(new Set(itemCodes));
  for (const chunk of chunkItems(uniqueCodes, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingInventoryRow>(
      `select id, "sapItemCode", "projectId", "warehouseId"
         from "inventoryItems"
        where "sapItemCode" = any($1::text[])`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return rows;
}

function inventoryDbKey(
  sapItemCode: string,
  projectId: number | null,
  warehouseId: number | null
) {
  return `${sapItemCode}::${projectId ?? "null"}::${warehouseId ?? "null"}`;
}

function planInventoryWrites(
  inventory: InventoryInput[],
  relations: ResolvedRelations,
  existingRows: ExistingInventoryRow[]
) {
  const existingByKey = new Map<string, ExistingInventoryRow>();
  let existingDuplicateKeys = 0;

  for (const row of existingRows) {
    const key = inventoryDbKey(row.sapItemCode, row.projectId, row.warehouseId);
    if (existingByKey.has(key)) {
      existingDuplicateKeys += 1;
      continue;
    }
    existingByKey.set(key, row);
  }

  const toInsert: InventoryInput[] = [];
  const toUpdate: Array<InventoryInput & { id: number }> = [];

  for (const item of inventory) {
    const project = relations.projectsByCode.get(item.projectCode);
    const warehouse = relations.warehousesByInputKey.get(
      warehouseInputKey(item.projectCode, item.warehouseLocalKey)
    );
    if (!project || !warehouse) {
      toInsert.push(item);
      continue;
    }

    const existing = existingByKey.get(
      inventoryDbKey(item.sapItemCode, project.id, warehouse.id)
    );
    if (existing) {
      toUpdate.push({ ...item, id: existing.id });
    } else {
      toInsert.push(item);
    }
  }

  return {
    toInsert,
    toUpdate,
    existingDuplicateKeys,
  };
}

async function insertMissingProjects(client: Client, data: ImportData) {
  const existing = await loadProjectsByCode(
    client,
    data.projects.map(project => project.code)
  );
  const missing = data.projects.filter(project => !existing.has(project.code));

  for (const chunk of chunkItems(missing, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `insert into "projects" (code, name, status, "sapProjectCode", "updatedAt")
       select x.code, x.name, 'activo', x.code, now()
         from jsonb_to_recordset($1::jsonb) as x(code text, name text)
       on conflict (code) do nothing`,
      [JSON.stringify(chunk.map(project => ({ code: project.code, name: project.name })))]
    );
  }

  return missing.length;
}

function buildWarehouseDisplayName(
  project: DbProject,
  warehouse: WarehouseInput
) {
  const projectLabel = `${project.code} - ${project.name}`.toUpperCase();
  return `${projectLabel} - ${warehouse.name.toUpperCase()}`.slice(
    0,
    FIELD_LIMITS.warehouseDisplayName
  );
}

function buildWarehouseCode(projectId: number, warehouse: WarehouseInput) {
  return `P${projectId}-${warehouse.localCode}`.slice(0, 20);
}

async function insertMissingWarehouses(client: Client, data: ImportData) {
  const projectsByCode = await loadProjectsByCode(
    client,
    data.projects.map(project => project.code)
  );
  const projectIds = Array.from(projectsByCode.values()).map(project => project.id);
  const existingWarehouses = await loadWarehousesByProjectIds(client, projectIds);
  const hasWarehouseByProject = new Set(
    existingWarehouses
      .filter(warehouse => typeof warehouse.projectId === "number")
      .map(warehouse => warehouse.projectId as number)
  );
  const plannedByKey = new Set<string>();
  const payload: Array<{
    code: string;
    localCode: string;
    name: string;
    displayName: string;
    projectId: number;
    description: string;
    isDefault: boolean;
    isActive: boolean;
  }> = [];

  for (const input of data.warehouses) {
    const project = projectsByCode.get(input.projectCode);
    if (!project) {
      throw new Error(`Proyecto no resuelto para almacen ${input.projectCode}`);
    }

    const existing = findWarehouse(existingWarehouses, project.id, input.localCode);
    const key = warehouseInputKey(input.projectCode, input.localKey);
    if (existing || plannedByKey.has(key)) continue;

    const isDefault = !hasWarehouseByProject.has(project.id);
    payload.push({
      code: buildWarehouseCode(project.id, input),
      localCode: input.localCode,
      name: input.name,
      displayName: buildWarehouseDisplayName(project, input),
      projectId: project.id,
      description: "Imported from article template.",
      isDefault,
      isActive: true,
    });
    plannedByKey.add(key);
    hasWarehouseByProject.add(project.id);
  }

  for (const chunk of chunkItems(payload, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `insert into "warehouses"
        (code, "localCode", name, "displayName", "projectId", description, "isDefault", "isActive", "updatedAt")
       select x.code,
              x."localCode",
              x.name,
              x."displayName",
              x."projectId",
              x.description,
              x."isDefault",
              x."isActive",
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           code text,
           "localCode" text,
           name text,
           "displayName" text,
           "projectId" integer,
           description text,
           "isDefault" boolean,
           "isActive" boolean
         )
       on conflict do nothing`,
      [JSON.stringify(chunk)]
    );
  }

  return payload.length;
}

function resolveCatalogForDb(
  catalog: CatalogInput[],
  relations: ResolvedRelations
) {
  return catalog.map(item => {
    const projectId = item.projectCode
      ? relations.projectsByCode.get(item.projectCode)?.id ?? null
      : null;
    if (item.tipoArticulo === 3 && item.projectCode && !projectId) {
      throw new Error(`Activo ${item.itemCode}: proyecto no resuelto ${item.projectCode}`);
    }

    return {
      itemCode: item.itemCode,
      description: item.description,
      itemGroup: item.itemGroup,
      brand: item.brand,
      partNumber: item.partNumber,
      tipoArticulo: item.tipoArticulo,
      projectId,
      temporaryItemCode: null,
      fixedAssetStatus: null,
      fixedAssetSerialNumber: item.fixedAssetSerialNumber,
      fixedAssetCondition: item.fixedAssetCondition,
      fixedAssetColor: item.fixedAssetColor,
      fixedAssetModel: item.fixedAssetModel,
      fixedAssetBrand: item.fixedAssetBrand,
      fixedAssetChassisSeries: item.fixedAssetChassisSeries,
      fixedAssetMotorSeries: item.fixedAssetMotorSeries,
      fixedAssetPlateOrCode: item.fixedAssetPlateOrCode,
      fixedAssetIsLeasing: item.fixedAssetIsLeasing,
      fixedAssetObservation: item.fixedAssetObservation,
      allowsTaxWithholding: item.allowsTaxWithholding,
      isActive: item.isActive,
    };
  });
}

function resolveInventoryForDb(
  inventory: InventoryInput[],
  relations: ResolvedRelations
) {
  return inventory.map(item => {
    const project = relations.projectsByCode.get(item.projectCode);
    const warehouse = relations.warehousesByInputKey.get(
      warehouseInputKey(item.projectCode, item.warehouseLocalKey)
    );

    if (!project) {
      throw new Error(`Inventario ${item.key}: proyecto no resuelto`);
    }
    if (!warehouse) {
      throw new Error(`Inventario ${item.key}: almacen no resuelto`);
    }

    return {
      key: item.key,
      sapItemCode: item.sapItemCode,
      name: item.name,
      description: item.description,
      unit: item.unit,
      category: item.category,
      currentStock: toMoneyString(item.currentStock),
      minimumStock:
        item.minimumStock === null ? null : toMoneyString(item.minimumStock),
      projectId: project.id,
      warehouseId: warehouse.id,
      warehouseLocation: warehouse.displayName,
      isActive: item.isActive,
    };
  });
}

async function upsertCatalog(client: Client, rows: ReturnType<typeof resolveCatalogForDb>) {
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `insert into "sapCatalog"
        (
          "itemCode",
          description,
          "itemGroup",
          "brand",
          "partNumber",
          "tipoArticulo",
          "projectId",
          "temporaryItemCode",
          "fixedAssetStatus",
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
          "allowsTaxWithholding",
          "isActive",
          "updatedAt"
        )
       select x."itemCode",
              x.description,
              x."itemGroup",
              x."brand",
              x."partNumber",
              x."tipoArticulo",
              x."projectId",
              x."temporaryItemCode",
              x."fixedAssetStatus",
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
              x."allowsTaxWithholding",
              x."isActive",
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "itemCode" text,
           description text,
           "itemGroup" text,
           "brand" text,
           "partNumber" text,
           "tipoArticulo" integer,
           "projectId" integer,
           "temporaryItemCode" text,
           "fixedAssetStatus" text,
           "fixedAssetSerialNumber" text,
           "fixedAssetCondition" text,
           "fixedAssetColor" text,
           "fixedAssetModel" text,
           "fixedAssetBrand" text,
           "fixedAssetChassisSeries" text,
           "fixedAssetMotorSeries" text,
           "fixedAssetPlateOrCode" text,
           "fixedAssetIsLeasing" boolean,
           "fixedAssetObservation" text,
           "allowsTaxWithholding" boolean,
           "isActive" boolean
         )
       on conflict ("itemCode") do update set
          description = excluded.description,
          "itemGroup" = excluded."itemGroup",
          "brand" = excluded."brand",
          "partNumber" = excluded."partNumber",
          "tipoArticulo" = excluded."tipoArticulo",
          "projectId" = excluded."projectId",
          "temporaryItemCode" = excluded."temporaryItemCode",
          "fixedAssetStatus" = excluded."fixedAssetStatus",
          "fixedAssetSerialNumber" = excluded."fixedAssetSerialNumber",
          "fixedAssetCondition" = excluded."fixedAssetCondition",
          "fixedAssetColor" = excluded."fixedAssetColor",
          "fixedAssetModel" = excluded."fixedAssetModel",
          "fixedAssetBrand" = excluded."fixedAssetBrand",
          "fixedAssetChassisSeries" = excluded."fixedAssetChassisSeries",
          "fixedAssetMotorSeries" = excluded."fixedAssetMotorSeries",
          "fixedAssetPlateOrCode" = excluded."fixedAssetPlateOrCode",
          "fixedAssetIsLeasing" = excluded."fixedAssetIsLeasing",
          "fixedAssetObservation" = excluded."fixedAssetObservation",
          "allowsTaxWithholding" = excluded."allowsTaxWithholding",
          "isActive" = excluded."isActive",
          "updatedAt" = excluded."updatedAt"`,
      [JSON.stringify(chunk)]
    );
  }
}

async function updateInventoryRows(
  client: Client,
  rows: Array<ReturnType<typeof resolveInventoryForDb>[number] & { id: number }>
) {
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    await client.query(
      `update "inventoryItems" as item
          set name = x.name,
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
           "isActive" boolean
         )
        where item.id = x.id`,
      [JSON.stringify(chunk)]
    );
  }
}

async function insertInventoryRows(
  client: Client,
  rows: ReturnType<typeof resolveInventoryForDb>
) {
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
           "isActive" boolean
         )`,
      [JSON.stringify(chunk)]
    );
  }
}

async function applyImport(
  client: Client,
  data: ImportData,
  existingCatalogCodes: Set<string>
): Promise<ApplyResult> {
  await client.query("begin");
  try {
    const insertedProjects = await insertMissingProjects(client, data);
    const insertedWarehouses = await insertMissingWarehouses(client, data);
    const relations = await resolveRelations(client, data);

    if (relations.missingProjectCodes.length > 0) {
      throw new Error(
        `No se resolvieron proyectos: ${relations.missingProjectCodes.join(", ")}`
      );
    }
    if (relations.missingWarehouseKeys.length > 0) {
      throw new Error(
        `No se resolvieron almacenes: ${relations.missingWarehouseKeys.join(", ")}`
      );
    }

    const resolvedCatalog = resolveCatalogForDb(data.catalog, relations);
    await upsertCatalog(client, resolvedCatalog);

    const resolvedInventory = resolveInventoryForDb(data.inventory, relations);
    const existingInventoryRows = await loadExistingInventoryRows(
      client,
      data.inventory.map(item => item.sapItemCode)
    );
    const existingInventoryByKey = new Map<string, ExistingInventoryRow>();
    let existingDuplicateKeys = 0;

    for (const row of existingInventoryRows) {
      const key = inventoryDbKey(row.sapItemCode, row.projectId, row.warehouseId);
      if (existingInventoryByKey.has(key)) {
        existingDuplicateKeys += 1;
      } else {
        existingInventoryByKey.set(key, row);
      }
    }

    const inventoryToInsert: typeof resolvedInventory = [];
    const inventoryToUpdate: Array<(typeof resolvedInventory)[number] & { id: number }> =
      [];

    for (const item of resolvedInventory) {
      const existing = existingInventoryByKey.get(
        inventoryDbKey(item.sapItemCode, item.projectId, item.warehouseId)
      );
      if (existing) {
        inventoryToUpdate.push({ ...item, id: existing.id });
      } else {
        inventoryToInsert.push(item);
      }
    }

    await updateInventoryRows(client, inventoryToUpdate);
    await insertInventoryRows(client, inventoryToInsert);
    await client.query("commit");

    return {
      projects: {
        existing: data.projects.length - insertedProjects,
        inserted: insertedProjects,
      },
      warehouses: {
        existing: data.warehouses.length - insertedWarehouses,
        inserted: insertedWarehouses,
      },
      catalog: {
        inserted: data.catalog.filter(item => !existingCatalogCodes.has(item.itemCode))
          .length,
        updated: data.catalog.filter(item => existingCatalogCodes.has(item.itemCode))
          .length,
      },
      inventory: {
        inserted: inventoryToInsert.length,
        updated: inventoryToUpdate.length,
        existingDuplicateKeys,
      },
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function verifyImport(
  client: Client,
  data: ImportData
): Promise<VerificationResult> {
  const itemCodes = data.catalog.map(item => item.itemCode);
  const articleCodes = data.inventory.map(item => item.sapItemCode);
  const projectCodes = data.projects.map(project => project.code);
  const projectsByCode = await loadProjectsByCode(client, projectCodes);
  const projectIds = Array.from(projectsByCode.values()).map(project => project.id);

  const catalogRowsForTemplate = await countScalar(
    client,
    `select count(*)::int as count
       from "sapCatalog"
      where "itemCode" = any($1::text[])`,
    [itemCodes]
  );
  const inventoryRowsForTemplateProjects = await countScalar(
    client,
    `select count(*)::int as count
       from "inventoryItems"
      where "projectId" = any($1::int[])
        and "sapItemCode" = any($2::text[])`,
    [projectIds, articleCodes]
  );
  const inventoryRowsMissingProjectOrWarehouse = await countScalar(
    client,
    `select count(*)::int as count
       from "inventoryItems"
      where "sapItemCode" = any($1::text[])
        and ("projectId" is null or "warehouseId" is null)`,
    [articleCodes]
  );
  const nonArticleInventoryRows = await countScalar(
    client,
    `select count(*)::int as count
       from "inventoryItems" inv
       join "sapCatalog" cat on cat."itemCode" = inv."sapItemCode"
      where inv."projectId" = any($1::int[])
        and inv."sapItemCode" = any($2::text[])
        and cat."tipoArticulo" <> 1`,
    [projectIds, itemCodes]
  );
  const byTypeResult = await client.query<{ type: string; count: number }>(
    `select case "tipoArticulo"
              when 1 then 'ARTICULO'
              when 2 then 'SERVICIO'
              when 3 then 'ACTIVO'
              else 'OTRO'
            end as type,
            count(*)::int as count
       from "sapCatalog"
      where "itemCode" = any($1::text[])
      group by type
      order by type`,
    [itemCodes]
  );
  const inventoryByProjectResult = await client.query<{
    projectCode: string;
    rows: number;
    totalStock: string;
  }>(
    `select p.code as "projectCode",
            count(inv.id)::int as rows,
            coalesce(sum(inv."currentStock"), 0)::text as "totalStock"
       from "projects" p
       left join "inventoryItems" inv
         on inv."projectId" = p.id
        and inv."sapItemCode" = any($2::text[])
      where p.id = any($1::int[])
      group by p.code
      order by p.code`,
    [projectIds, articleCodes]
  );

  return {
    catalogRowsForTemplate,
    inventoryRowsForTemplateProjects,
    inventoryRowsMissingProjectOrWarehouse,
    nonArticleInventoryRows,
    catalogByType: Object.fromEntries(
      byTypeResult.rows.map(row => [row.type, row.count])
    ),
    inventoryByProject: inventoryByProjectResult.rows,
  };
}

async function countScalar(client: Client, sql: string, params: unknown[]) {
  const result = await client.query<{ count: number }>(sql, params);
  return result.rows[0]?.count ?? 0;
}

async function writeReport(reportPath: string | undefined, report: ImportReport) {
  if (!reportPath) return;
  const directory = path.dirname(reportPath);
  await mkdir(directory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function buildReport(
  mode: CliOptions["mode"],
  data: ImportData,
  dbPlan: Awaited<ReturnType<typeof buildDbPlan>>,
  applyResult?: ApplyResult,
  verification?: VerificationResult
): ImportReport {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    source: {
      file: data.file,
      sheetName: data.sheetName,
      rawRows: data.rawRows,
    },
    summary: {
      parsedRows: data.parsedRows.length,
      skippedRows: data.skippedRows.length,
      projects: data.projects.length,
      warehouses: data.warehouses.length,
      catalogItems: data.catalog.length,
      inventoryRows: data.inventory.length,
      catalogByType: catalogByType(data.catalog),
    },
    dbPlan: {
      missingProjects: dbPlan.relations.missingProjectCodes,
      missingWarehouses: dbPlan.relations.missingWarehouseKeys,
      catalog: {
        existing: dbPlan.existingCatalogCodes.size,
        toInsert: data.catalog.length - dbPlan.existingCatalogCodes.size,
        toUpdate: dbPlan.existingCatalogCodes.size,
      },
      inventory: {
        existing: dbPlan.inventoryPlan.toUpdate.length,
        toInsert: dbPlan.inventoryPlan.toInsert.length,
        toUpdate: dbPlan.inventoryPlan.toUpdate.length,
        existingDuplicateKeys: dbPlan.inventoryPlan.existingDuplicateKeys,
      },
    },
    applyResult,
    verification,
    skippedRows: data.skippedRows,
    conflicts: data.conflicts,
    validationErrors: data.validationErrors,
  };
}

function printSummary(report: ImportReport) {
  console.log(`Modo: ${report.mode}`);
  console.log(`Archivo: ${report.source.file}`);
  console.log(`Filas leidas: ${report.source.rawRows}`);
  console.log(`Filas validas: ${report.summary.parsedRows}`);
  console.log(`Filas omitidas: ${report.summary.skippedRows}`);
  console.log(`Proyectos: ${report.summary.projects}`);
  console.log(`Almacenes: ${report.summary.warehouses}`);
  console.log(`Catalogo: ${report.summary.catalogItems}`);
  console.log(`Inventario: ${report.summary.inventoryRows}`);
  console.log(`Catalogo por tipo: ${JSON.stringify(report.summary.catalogByType)}`);
  console.log(`Conflictos reportados: ${report.conflicts.length}`);
  console.log(`Errores de validacion: ${report.validationErrors.length}`);

  if (report.validationErrors.length > 0) {
    for (const error of report.validationErrors.slice(0, 20)) {
      console.log(`  - ${error}`);
    }
  }

  if (report.applyResult) {
    console.log(`Proyectos insertados: ${report.applyResult.projects.inserted}`);
    console.log(`Almacenes insertados: ${report.applyResult.warehouses.inserted}`);
    console.log(`Catalogo insertado: ${report.applyResult.catalog.inserted}`);
    console.log(`Catalogo actualizado: ${report.applyResult.catalog.updated}`);
    console.log(`Inventario insertado: ${report.applyResult.inventory.inserted}`);
    console.log(`Inventario actualizado: ${report.applyResult.inventory.updated}`);
  }

  if (report.verification) {
    console.log(
      `Verificacion catalogo plantilla: ${report.verification.catalogRowsForTemplate}`
    );
    console.log(
      `Verificacion inventario plantilla: ${report.verification.inventoryRowsForTemplateProjects}`
    );
    console.log(
      `Inventario sin proyecto/almacen: ${report.verification.inventoryRowsMissingProjectOrWarehouse}`
    );
    console.log(
      `Inventario de servicios/activos: ${report.verification.nonArticleInventoryRows}`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = readWorkbook(options.file);
  const connectionString = requireDatabaseUrl();
  const client = new Client({ connectionString });

  await client.connect();
  try {
    const dbPlan = await buildDbPlan(client, data);

    if (data.validationErrors.length > 0) {
      const report = buildReport(options.mode, data, dbPlan);
      await writeReport(options.report, report);
      printSummary(report);
      throw new Error(
        `La plantilla tiene ${data.validationErrors.length} errores de validacion`
      );
    }

    let applyResult: ApplyResult | undefined;
    let verification: VerificationResult | undefined;

    if (options.mode === "apply") {
      applyResult = await applyImport(client, data, dbPlan.existingCatalogCodes);
      verification = await verifyImport(client, data);
    }

    const report = buildReport(options.mode, data, dbPlan, applyResult, verification);
    await writeReport(options.report, report);
    printSummary(report);

    if (options.report) {
      console.log(`Reporte: ${options.report}`);
    }
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
