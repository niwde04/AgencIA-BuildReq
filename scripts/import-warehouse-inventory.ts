import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const SHEET_NAME = "Hoja1";
const BATCH_SIZE = 500;
const REQUIRED_HEADERS = ["CODIGO", "Bodega", "UNIDAD DE MEDIDA", "Cantidades"] as const;

type Mode = "dry-run" | "apply" | "zero";

type CliOptions = {
  mode: Mode;
  file?: string;
  report?: string;
  zeroFromReport?: string;
};

type RawExcelRow = Record<string, unknown>;

type WarehouseRef = {
  id: number;
  code: string;
  localCode: string | null;
  name: string;
  displayName: string;
};

type CatalogRef = {
  itemCode: string;
  description: string;
};

type ExistingInventoryRow = {
  id: number;
  sapItemCode: string;
  name: string;
  description: string | null;
  unit: string | null;
  category: string | null;
  currentStock: string;
  minimumStock: string | null;
  projectId: number | null;
  warehouseId: number | null;
  warehouseLocation: string | null;
  isActive: boolean;
};

type SkippedRow = {
  rowNumber: number;
  reason: string;
  codigo: string | null;
  bodega: string | null;
  unit: string | null;
  quantity: unknown;
};

type ParsedExcelRow = {
  rowNumber: number;
  sapItemCode: string;
  warehouseRaw: string;
  warehouseCode: string;
  warehouseKey: string;
  unit: string | null;
  quantity: number;
};

type InventoryGroup = {
  key: string;
  sapItemCode: string;
  warehouseRaw: string;
  warehouseCode: string;
  warehouseKey: string;
  unit: string | null;
  quantity: string;
  sourceRows: number[];
};

type ResolvedInventoryGroup = InventoryGroup & {
  warehouse: WarehouseRef;
  catalog: CatalogRef;
};

type PlannedInventoryRow = {
  key: string;
  sapItemCode: string;
  name: string;
  description: string | null;
  unit: string | null;
  category: string | null;
  currentStock: string;
  projectId: null;
  warehouseId: number;
  warehouseLocation: string;
  isActive: true;
  sourceRows: number[];
};

type PlannedUpdate = PlannedInventoryRow & {
  id: number;
  previous: ExistingInventoryRow;
};

type PlannedInsert = PlannedInventoryRow;

type PlannedSuperseded = {
  id: number;
  reason: "duplicate_replaced" | "not_in_file";
  previous: ExistingInventoryRow;
};

type AppliedInventoryRow = {
  id: number;
  sapItemCode: string;
  warehouseId: number;
  warehouseLocation: string;
  currentStock: string;
};

type ImportPlan = {
  updates: PlannedUpdate[];
  inserts: PlannedInsert[];
  superseded: PlannedSuperseded[];
  targetWarehouses: WarehouseRef[];
};

type WarehouseSummary = {
  warehouseId: number;
  code: string;
  displayName: string;
  rows: number;
  uniqueItems: number;
  totalStock: string;
};

type ImportReport = {
  generatedAt: string;
  mode: Mode;
  source?: {
    file: string;
    sheetName: string;
    rawRows: number;
  };
  summary: {
    rawRows: number;
    parsedRows: number;
    validGroupedRows: number;
    uniqueCodes: number;
    targetWarehouses: number;
    skippedRows: number;
    missingWarehouseGroups: number;
    missingCatalogGroups: number;
    duplicateGroups: number;
  };
  plan?: {
    updates: number;
    inserts: number;
    superseded: number;
    supersededDuplicates: number;
    supersededNotInFile: number;
  };
  applyResult?: {
    updated: number;
    inserted: number;
    superseded: number;
  };
  zeroResult?: {
    updatedToZero: number;
    missingIds: number[];
  };
  warehouseSummary: WarehouseSummary[];
  skippedRows: SkippedRow[];
  duplicateGroups: Array<{
    key: string;
    warehouseRaw: string;
    sapItemCode: string;
    sourceRows: number[];
    totalQuantity: string;
  }>;
  missingWarehouses: Array<{
    warehouseRaw: string;
    warehouseCode: string;
    warehouseKey: string;
    groups: number;
  }>;
  missingCatalogCodes: string[];
  beforeRows?: ExistingInventoryRow[];
  importedRows?: Array<{
    id?: number;
    sapItemCode: string;
    warehouseId: number;
    warehouseLocation: string;
    currentStock: string;
  }>;
  supersededRows?: PlannedSuperseded[];
  verification?: {
    warehouseSummary: WarehouseSummary[];
    positiveRowsWithProjectInTargetWarehouses: number;
    positiveRowsOutsideImportedIdsInTargetWarehouses: number;
  };
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-warehouse-inventory.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-warehouse-inventory.ts --file <xlsx> --apply --report <json>",
      "  pnpm exec tsx scripts/import-warehouse-inventory.ts --zero-from-report <json> --report <json>",
    ].join("\n")
  );
}

function parseArgs(argv: string[]): CliOptions {
  let mode: Mode | undefined;
  let file: string | undefined;
  let report: string | undefined;
  let zeroFromReport: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      file = argv[index + 1];
      index += 1;
    } else if (arg === "--report") {
      report = argv[index + 1];
      index += 1;
    } else if (arg === "--dry-run") {
      mode = "dry-run";
    } else if (arg === "--apply") {
      mode = "apply";
    } else if (arg === "--zero-from-report") {
      mode = "zero";
      zeroFromReport = argv[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  if (!mode) throw new Error("Debe indicar --dry-run, --apply o --zero-from-report");
  if ((mode === "dry-run" || mode === "apply") && !file) {
    throw new Error("Debe indicar --file <xlsx>");
  }
  if (mode === "zero" && !zeroFromReport) {
    throw new Error("Debe indicar --zero-from-report <json>");
  }

  return { mode, file, report, zeroFromReport };
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

function normalizeWarehouseKey(value: unknown) {
  const text = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  const withoutDashes = text.replace(/^-+|-+$/g, "");
  const withoutLeadingZeroes = withoutDashes.replace(/^0+/, "");
  return withoutLeadingZeroes || withoutDashes || "0";
}

function parseWarehouse(value: unknown) {
  const raw = normalizeText(value);
  const match = raw.match(/^(\d+)\s+(.+)$/);
  const warehouseCode = match ? match[1] : raw.split(" ")[0] ?? "";
  return {
    raw,
    code: warehouseCode,
    key: normalizeWarehouseKey(warehouseCode),
  };
}

function parseQuantity(value: unknown) {
  if (value === null || value === undefined || normalizeText(value) === "") {
    return { value: null, error: "Cantidad vacía" };
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { value, error: null }
      : { value: null, error: "Cantidad inválida" };
  }

  const compact = normalizeText(value).replace(/\s+/g, "");
  if (compact === "-" || compact === "--") {
    return { value: null, error: "Cantidad inválida" };
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
    return { value: null, error: "Cantidad inválida" };
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed)
    ? { value: parsed, error: null }
    : { value: null, error: "Cantidad inválida" };
}

function toDecimalString(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Número inválido: ${value}`);
  return numeric.toFixed(2);
}

function addDecimalStrings(left: string, right: string) {
  return toDecimalString(Number(left) + Number(right));
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function requireDatabaseUrl() {
  dotenv.config({ path: ".env" });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está configurado en .env");
  return connectionString;
}

function readWorkbook(file: string) {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const worksheet = workbook.Sheets[SHEET_NAME];
  if (!worksheet) throw new Error(`No se encontró la hoja ${SHEET_NAME}`);

  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const actualHeaders = new Set((headerRows[0] ?? []).map(normalizeText));
  const missingHeaders = REQUIRED_HEADERS.filter(header => !actualHeaders.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Faltan encabezados requeridos: ${missingHeaders.join(", ")}`);
  }

  const rows = XLSX.utils.sheet_to_json<RawExcelRow>(worksheet, {
    defval: null,
    blankrows: false,
  });

  return {
    file,
    rawRows: rows,
  };
}

function parseRows(rows: RawExcelRow[]) {
  const parsedRows: ParsedExcelRow[] = [];
  const skippedRows: SkippedRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const sapItemCode = normalizeText(row.CODIGO);
    const warehouse = parseWarehouse(row.Bodega);
    const unit = normalizeText(row["UNIDAD DE MEDIDA"]) || null;
    const quantity = parseQuantity(row.Cantidades);

    if (!sapItemCode) {
      skippedRows.push({
        rowNumber,
        reason: "Sin CODIGO",
        codigo: null,
        bodega: warehouse.raw || null,
        unit,
        quantity: row.Cantidades,
      });
      continue;
    }

    if (!warehouse.raw || !warehouse.code) {
      skippedRows.push({
        rowNumber,
        reason: "Sin Bodega",
        codigo: sapItemCode,
        bodega: warehouse.raw || null,
        unit,
        quantity: row.Cantidades,
      });
      continue;
    }

    if (quantity.error || quantity.value === null) {
      skippedRows.push({
        rowNumber,
        reason: quantity.error ?? "Cantidad inválida",
        codigo: sapItemCode,
        bodega: warehouse.raw,
        unit,
        quantity: row.Cantidades,
      });
      continue;
    }

    parsedRows.push({
      rowNumber,
      sapItemCode,
      warehouseRaw: warehouse.raw,
      warehouseCode: warehouse.code,
      warehouseKey: warehouse.key,
      unit,
      quantity: quantity.value,
    });
  }

  return { parsedRows, skippedRows };
}

function groupRows(rows: ParsedExcelRow[]) {
  const groupsByKey = new Map<string, InventoryGroup>();
  const duplicateGroups: ImportReport["duplicateGroups"] = [];

  for (const row of rows) {
    const key = `${row.warehouseKey}::${row.sapItemCode}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.quantity = addDecimalStrings(existing.quantity, toDecimalString(row.quantity));
      existing.sourceRows.push(row.rowNumber);
      if (!existing.unit && row.unit) existing.unit = row.unit;
      continue;
    }

    groupsByKey.set(key, {
      key,
      sapItemCode: row.sapItemCode,
      warehouseRaw: row.warehouseRaw,
      warehouseCode: row.warehouseCode,
      warehouseKey: row.warehouseKey,
      unit: row.unit,
      quantity: toDecimalString(row.quantity),
      sourceRows: [row.rowNumber],
    });
  }

  for (const group of Array.from(groupsByKey.values())) {
    if (group.sourceRows.length <= 1) continue;
    duplicateGroups.push({
      key: group.key,
      warehouseRaw: group.warehouseRaw,
      sapItemCode: group.sapItemCode,
      sourceRows: group.sourceRows,
      totalQuantity: group.quantity,
    });
  }

  return {
    groups: Array.from(groupsByKey.values()).sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
    duplicateGroups,
  };
}

async function loadWarehouses(client: Client) {
  const result = await client.query<WarehouseRef>(
    `select id, code, "localCode", name, "displayName"
       from "warehouses"
      where "isActive" = true
      order by code`
  );
  return result.rows;
}

function buildWarehouseLookup(warehouses: WarehouseRef[]) {
  const lookup = new Map<string, WarehouseRef>();
  for (const warehouse of warehouses) {
    for (const value of [warehouse.code, warehouse.localCode]) {
      const key = normalizeWarehouseKey(value);
      if (key) lookup.set(key, warehouse);
    }
  }
  return lookup;
}

async function loadCatalog(client: Client, itemCodes: string[]) {
  const rows: CatalogRef[] = [];
  const uniqueCodes = Array.from(new Set(itemCodes));
  for (const chunk of chunkItems(uniqueCodes, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<CatalogRef>(
      `select "itemCode",
              description
         from "sapCatalog"
        where "itemCode" = any($1::text[])`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return new Map(rows.map(row => [row.itemCode, row]));
}

function resolveGroups(
  groups: InventoryGroup[],
  warehouseLookup: Map<string, WarehouseRef>,
  catalogLookup: Map<string, CatalogRef>
) {
  const resolved: ResolvedInventoryGroup[] = [];
  const missingWarehousesByKey = new Map<string, ImportReport["missingWarehouses"][number]>();
  const missingCatalogCodes = new Set<string>();

  for (const group of groups) {
    const warehouse = warehouseLookup.get(group.warehouseKey);
    if (!warehouse) {
      const existing = missingWarehousesByKey.get(group.warehouseKey);
      if (existing) {
        existing.groups += 1;
      } else {
        missingWarehousesByKey.set(group.warehouseKey, {
          warehouseRaw: group.warehouseRaw,
          warehouseCode: group.warehouseCode,
          warehouseKey: group.warehouseKey,
          groups: 1,
        });
      }
      continue;
    }

    const catalog = catalogLookup.get(group.sapItemCode);
    if (!catalog) {
      missingCatalogCodes.add(group.sapItemCode);
      continue;
    }

    resolved.push({ ...group, warehouse, catalog });
  }

  return {
    resolved,
    missingWarehouses: Array.from(missingWarehousesByKey.values()),
    missingCatalogCodes: Array.from(missingCatalogCodes).sort(),
  };
}

async function loadExistingInventory(client: Client, warehouseIds: number[]) {
  if (warehouseIds.length === 0) return [] as ExistingInventoryRow[];
  const result = await client.query<ExistingInventoryRow>(
    `select id,
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
            "isActive"
       from "inventoryItems"
      where "warehouseId" = any($1::int[])
      order by "warehouseId", "sapItemCode", id`,
    [warehouseIds]
  );
  return result.rows;
}

function inventoryDbKey(warehouseId: number | null, sapItemCode: string) {
  return `${warehouseId ?? "null"}::${sapItemCode}`;
}

function buildPlan(
  resolvedGroups: ResolvedInventoryGroup[],
  existingRows: ExistingInventoryRow[],
  targetWarehouses: WarehouseRef[]
): ImportPlan {
  const existingByKey = new Map<string, ExistingInventoryRow[]>();
  for (const row of existingRows) {
    const key = inventoryDbKey(row.warehouseId, row.sapItemCode);
    const bucket = existingByKey.get(key) ?? [];
    bucket.push(row);
    existingByKey.set(key, bucket);
  }

  const updates: PlannedUpdate[] = [];
  const inserts: PlannedInsert[] = [];
  const superseded: PlannedSuperseded[] = [];
  const importedKeys = new Set<string>();

  for (const group of resolvedGroups) {
    const key = inventoryDbKey(group.warehouse.id, group.sapItemCode);
    importedKeys.add(key);
    const existingForKey = existingByKey.get(key) ?? [];
    const canonical = existingForKey[0];
    const planned: PlannedInventoryRow = {
      key,
      sapItemCode: group.sapItemCode,
      name: group.catalog.description || group.sapItemCode,
      description: group.catalog.description || null,
      unit: group.unit,
      category: null,
      currentStock: group.quantity,
      projectId: null,
      warehouseId: group.warehouse.id,
      warehouseLocation: group.warehouse.displayName,
      isActive: true,
      sourceRows: group.sourceRows,
    };

    if (canonical) {
      updates.push({
        ...planned,
        id: canonical.id,
        previous: canonical,
      });
      for (const duplicate of existingForKey.slice(1)) {
        superseded.push({
          id: duplicate.id,
          reason: "duplicate_replaced",
          previous: duplicate,
        });
      }
    } else {
      inserts.push(planned);
    }
  }

  for (const row of existingRows) {
    const key = inventoryDbKey(row.warehouseId, row.sapItemCode);
    if (importedKeys.has(key)) continue;
    superseded.push({
      id: row.id,
      reason: "not_in_file",
      previous: row,
    });
  }

  return {
    updates,
    inserts,
    superseded,
    targetWarehouses,
  };
}

function summarizePlannedByWarehouse(rows: PlannedInventoryRow[], warehouses: WarehouseRef[]) {
  const summariesByWarehouseId = new Map<number, WarehouseSummary>();
  for (const warehouse of warehouses) {
    summariesByWarehouseId.set(warehouse.id, {
      warehouseId: warehouse.id,
      code: warehouse.code,
      displayName: warehouse.displayName,
      rows: 0,
      uniqueItems: 0,
      totalStock: "0.00",
    });
  }

  for (const row of rows) {
    const summary = summariesByWarehouseId.get(row.warehouseId);
    if (!summary) continue;
    summary.rows += 1;
    summary.uniqueItems += 1;
    summary.totalStock = addDecimalStrings(summary.totalStock, row.currentStock);
  }

  return Array.from(summariesByWarehouseId.values()).sort((left, right) =>
    left.code.localeCompare(right.code, "es-HN", { numeric: true })
  );
}

async function summarizeCurrentByWarehouse(client: Client, warehouseIds: number[]) {
  if (warehouseIds.length === 0) return [] as WarehouseSummary[];
  const result = await client.query<WarehouseSummary>(
    `select w.id as "warehouseId",
            w.code,
            w."displayName",
            count(i.id)::int as rows,
            count(distinct i."sapItemCode")::int as "uniqueItems",
            coalesce(sum(i."currentStock"), 0)::numeric(12, 2)::text as "totalStock"
       from "warehouses" w
       left join "inventoryItems" i on i."warehouseId" = w.id
      where w.id = any($1::int[])
      group by w.id, w.code, w."displayName"
      order by w.code`,
    [warehouseIds]
  );
  return result.rows;
}

async function countPositiveRowsWithProject(client: Client, warehouseIds: number[]) {
  if (warehouseIds.length === 0) return 0;
  const result = await client.query<{ count: number }>(
    `select count(*)::int as count
       from "inventoryItems"
      where "warehouseId" = any($1::int[])
        and "projectId" is not null
        and "currentStock"::numeric > 0`,
    [warehouseIds]
  );
  return result.rows[0]?.count ?? 0;
}

async function countPositiveRowsOutsideImportedIds(
  client: Client,
  warehouseIds: number[],
  importedIds: number[]
) {
  if (warehouseIds.length === 0) return 0;
  const result = await client.query<{ count: number }>(
    `select count(*)::int as count
       from "inventoryItems"
      where "warehouseId" = any($1::int[])
        and "currentStock"::numeric > 0
        and not ("id" = any($2::int[]))`,
    [warehouseIds, importedIds]
  );
  return result.rows[0]?.count ?? 0;
}

async function updateInventoryRows(client: Client, rows: PlannedUpdate[]) {
  let updated = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `update "inventoryItems" as item
          set "sapItemCode" = x."sapItemCode",
              name = x.name,
              description = x.description,
              unit = x.unit,
              category = x.category,
              "currentStock" = x."currentStock"::numeric,
              "projectId" = null,
              "warehouseId" = x."warehouseId",
              "warehouseLocation" = x."warehouseLocation",
              "isActive" = true,
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           "sapItemCode" text,
           name text,
           description text,
           unit text,
           category text,
           "currentStock" text,
           "warehouseId" integer,
           "warehouseLocation" text
         )
        where item.id = x.id`,
      [JSON.stringify(chunk)]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

async function insertInventoryRows(client: Client, rows: PlannedInsert[]) {
  const insertedIds: number[] = [];
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<{ id: number }>(
      `insert into "inventoryItems"
        (
          "sapItemCode",
          name,
          description,
          unit,
          category,
          "currentStock",
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
              null,
              x."warehouseId",
              x."warehouseLocation",
              true,
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "sapItemCode" text,
           name text,
           description text,
           unit text,
           category text,
           "currentStock" text,
           "warehouseId" integer,
           "warehouseLocation" text
         )
      returning id`,
      [JSON.stringify(chunk)]
    );
    insertedIds.push(...result.rows.map(row => row.id));
  }
  return insertedIds;
}

async function supersedeInventoryRows(client: Client, rows: PlannedSuperseded[]) {
  let updated = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `update "inventoryItems"
          set "currentStock" = 0,
              "projectId" = null,
              "warehouseId" = null,
              "warehouseLocation" = null,
              "isActive" = false,
              "updatedAt" = now()
        where id = any($1::int[])`,
      [chunk.map(row => row.id)]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

function getPlannedRowId(row: PlannedUpdate | PlannedInsert) {
  return "previous" in row ? row.id : undefined;
}

function buildReport(params: {
  mode: Mode;
  file?: string;
  rawRows?: number;
  parsedRows?: ParsedExcelRow[];
  groups?: InventoryGroup[];
  skippedRows?: SkippedRow[];
  duplicateGroups?: ImportReport["duplicateGroups"];
  missingWarehouses?: ImportReport["missingWarehouses"];
  missingCatalogCodes?: string[];
  plan?: ImportPlan;
  applyResult?: ImportReport["applyResult"];
  zeroResult?: ImportReport["zeroResult"];
  warehouseSummary?: WarehouseSummary[];
  verification?: ImportReport["verification"];
}): ImportReport {
  const plannedRows = [
    ...(params.plan?.updates ?? []),
    ...(params.plan?.inserts ?? []),
  ];
  const beforeRows = params.plan
    ? [
        ...params.plan.updates.map(row => row.previous),
        ...params.plan.superseded.map(row => row.previous),
      ]
    : undefined;
  const importedRows = plannedRows.map(row => ({
    id: getPlannedRowId(row),
    sapItemCode: row.sapItemCode,
    warehouseId: row.warehouseId,
    warehouseLocation: row.warehouseLocation,
    currentStock: row.currentStock,
  }));

  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    source: params.file
      ? {
          file: params.file,
          sheetName: SHEET_NAME,
          rawRows: params.rawRows ?? 0,
        }
      : undefined,
    summary: {
      rawRows: params.rawRows ?? 0,
      parsedRows: params.parsedRows?.length ?? 0,
      validGroupedRows: params.groups?.length ?? 0,
      uniqueCodes: new Set((params.groups ?? []).map(group => group.sapItemCode)).size,
      targetWarehouses: params.plan?.targetWarehouses.length ?? 0,
      skippedRows: params.skippedRows?.length ?? 0,
      missingWarehouseGroups: params.missingWarehouses?.reduce(
        (total, warehouse) => total + warehouse.groups,
        0
      ) ?? 0,
      missingCatalogGroups: params.missingCatalogCodes?.length ?? 0,
      duplicateGroups: params.duplicateGroups?.length ?? 0,
    },
    plan: params.plan
      ? {
          updates: params.plan.updates.length,
          inserts: params.plan.inserts.length,
          superseded: params.plan.superseded.length,
          supersededDuplicates: params.plan.superseded.filter(
            row => row.reason === "duplicate_replaced"
          ).length,
          supersededNotInFile: params.plan.superseded.filter(
            row => row.reason === "not_in_file"
          ).length,
        }
      : undefined,
    applyResult: params.applyResult,
    zeroResult: params.zeroResult,
    warehouseSummary: params.warehouseSummary ?? [],
    skippedRows: params.skippedRows ?? [],
    duplicateGroups: params.duplicateGroups ?? [],
    missingWarehouses: params.missingWarehouses ?? [],
    missingCatalogCodes: params.missingCatalogCodes ?? [],
    beforeRows,
    importedRows,
    supersededRows: params.plan?.superseded,
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
  if (report.source) console.log(`Archivo: ${report.source.file}`);
  console.log(`Filas Excel: ${report.summary.rawRows}`);
  console.log(`Filas válidas agrupadas: ${report.summary.validGroupedRows}`);
  console.log(`Códigos únicos: ${report.summary.uniqueCodes}`);
  console.log(`Filas omitidas: ${report.summary.skippedRows}`);
  console.log(`Grupos duplicados: ${report.summary.duplicateGroups}`);
  console.log(`Bodegas sin empatar: ${report.summary.missingWarehouseGroups}`);
  console.log(`Códigos sin catálogo: ${report.summary.missingCatalogGroups}`);
  if (report.plan) {
    console.log(`Actualizaciones: ${report.plan.updates}`);
    console.log(`Inserciones: ${report.plan.inserts}`);
    console.log(`Filas sustituidas/fuera del almacén: ${report.plan.superseded}`);
  }
  if (report.applyResult) {
    console.log(`Aplicado - actualizadas: ${report.applyResult.updated}`);
    console.log(`Aplicado - insertadas: ${report.applyResult.inserted}`);
    console.log(`Aplicado - sustituidas: ${report.applyResult.superseded}`);
  }
  if (report.zeroResult) {
    console.log(`Puestas en cero: ${report.zeroResult.updatedToZero}`);
    console.log(`IDs no encontrados: ${report.zeroResult.missingIds.length}`);
  }
  for (const summary of report.warehouseSummary) {
    console.log(
      `${summary.displayName}: ${summary.rows} filas, stock ${summary.totalStock}`
    );
  }
}

async function buildImportPlan(client: Client, file: string) {
  const workbook = readWorkbook(file);
  const { parsedRows, skippedRows } = parseRows(workbook.rawRows);
  const { groups, duplicateGroups } = groupRows(parsedRows);

  const warehouses = await loadWarehouses(client);
  const warehouseLookup = buildWarehouseLookup(warehouses);
  const catalogLookup = await loadCatalog(
    client,
    groups.map(group => group.sapItemCode)
  );
  const { resolved, missingWarehouses, missingCatalogCodes } = resolveGroups(
    groups,
    warehouseLookup,
    catalogLookup
  );

  const targetWarehouses = Array.from(
    new Map(resolved.map(group => [group.warehouse.id, group.warehouse])).values()
  ).sort((left, right) =>
    left.code.localeCompare(right.code, "es-HN", { numeric: true })
  );
  const existingRows = await loadExistingInventory(
    client,
    targetWarehouses.map(warehouse => warehouse.id)
  );
  const plan = buildPlan(resolved, existingRows, targetWarehouses);
  const plannedRows = [...plan.updates, ...plan.inserts];
  const warehouseSummary = summarizePlannedByWarehouse(plannedRows, targetWarehouses);

  return {
    file,
    rawRows: workbook.rawRows.length,
    parsedRows,
    skippedRows,
    groups,
    duplicateGroups,
    missingWarehouses,
    missingCatalogCodes,
    plan,
    warehouseSummary,
  };
}

async function applyImport(client: Client, plan: ImportPlan) {
  await client.query("begin");
  try {
    const updated = await updateInventoryRows(client, plan.updates);
    const insertedIds = await insertInventoryRows(client, plan.inserts);
    const superseded = await supersedeInventoryRows(client, plan.superseded);
    await client.query("commit");

    const updateIds = plan.updates.map(row => row.id);
    return {
      result: {
        updated,
        inserted: insertedIds.length,
        superseded,
      },
      importedIds: [...updateIds, ...insertedIds],
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function buildVerification(
  client: Client,
  warehouseIds: number[],
  importedIds: number[]
) {
  return {
    warehouseSummary: await summarizeCurrentByWarehouse(client, warehouseIds),
    positiveRowsWithProjectInTargetWarehouses: await countPositiveRowsWithProject(
      client,
      warehouseIds
    ),
    positiveRowsOutsideImportedIdsInTargetWarehouses:
      await countPositiveRowsOutsideImportedIds(client, warehouseIds, importedIds),
  };
}

async function zeroFromReport(client: Client, reportPath: string) {
  const content = await readFile(reportPath, "utf8");
  const report = JSON.parse(content) as ImportReport;
  const importedIds = (report.importedRows ?? [])
    .map(row => row.id)
    .filter((id): id is number => typeof id === "number");
  if (importedIds.length === 0) {
    throw new Error("El reporte no contiene IDs importados para poner en cero");
  }

  const existing = await client.query<{ id: number }>(
    `select id from "inventoryItems" where id = any($1::int[])`,
    [importedIds]
  );
  const existingIds = new Set(existing.rows.map(row => row.id));
  const missingIds = importedIds.filter(id => !existingIds.has(id));

  await client.query("begin");
  try {
    let updatedToZero = 0;
    for (const chunk of chunkItems(Array.from(existingIds), BATCH_SIZE)) {
      if (chunk.length === 0) continue;
      const result = await client.query(
        `update "inventoryItems"
            set "currentStock" = 0,
                "updatedAt" = now()
          where id = any($1::int[])`,
        [chunk]
      );
      updatedToZero += result.rowCount ?? 0;
    }
    await client.query("commit");
    return { updatedToZero, missingIds };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: requireDatabaseUrl() });

  await client.connect();
  try {
    if (options.mode === "zero") {
      const zeroResult = await zeroFromReport(client, options.zeroFromReport!);
      const report = buildReport({
        mode: "zero",
        zeroResult,
      });
      await writeReport(options.report, report);
      printSummary(report);
      if (options.report) console.log(`Reporte: ${options.report}`);
      return;
    }

    const planData = await buildImportPlan(client, options.file!);
    let applyResult: ImportReport["applyResult"] | undefined;
    let verification: ImportReport["verification"] | undefined;
    let importedIds = planData.plan.updates.map(row => row.id);

    if (planData.missingWarehouses.length > 0 || planData.missingCatalogCodes.length > 0) {
      const report = buildReport({
        mode: options.mode,
        ...planData,
      });
      await writeReport(options.report, report);
      printSummary(report);
      throw new Error("Hay bodegas o códigos de catálogo sin empatar; no se aplicó la carga");
    }

    if (options.mode === "apply") {
      const applied = await applyImport(client, planData.plan);
      applyResult = applied.result;
      importedIds = applied.importedIds;
      verification = await buildVerification(
        client,
        planData.plan.targetWarehouses.map(warehouse => warehouse.id),
        importedIds
      );
    }

    const report = buildReport({
      mode: options.mode,
      ...planData,
      applyResult,
      verification,
    });
    if (options.mode === "apply") {
      report.importedRows = report.importedRows?.map(row => {
        if (row.id) return row;
        return row;
      });
      let appliedRows: AppliedInventoryRow[] = [];
      if (verification) {
        const insertedRows = await client.query<AppliedInventoryRow>(
            `select id,
                    "sapItemCode",
                    "warehouseId",
                    "warehouseLocation",
                    "currentStock"
               from "inventoryItems"
              where id = any($1::int[])
              order by id`,
            [importedIds]
          );
        appliedRows = insertedRows.rows;
      }
      const idByKey = new Map(
        appliedRows.map(row => [
          `${row.warehouseId}::${row.sapItemCode}::${toDecimalString(row.currentStock)}`,
          row.id,
        ])
      );
      report.importedRows = report.importedRows?.map(row => ({
        ...row,
        id:
          row.id ??
          idByKey.get(
            `${row.warehouseId}::${row.sapItemCode}::${toDecimalString(row.currentStock)}`
          ),
      }));
    }
    await writeReport(options.report, report);
    printSummary(report);
    if (options.report) console.log(`Reporte: ${options.report}`);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
