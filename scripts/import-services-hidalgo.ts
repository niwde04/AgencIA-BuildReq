import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const DEFAULT_SHEET_NAME = "SERVICIOS";
const SERVICE_ARTICLE_TYPE = 2;
const BATCH_SIZE = 500;

const REQUIRED_HEADERS = [
  "codigo_sap*",
  "descripcion_servicio*",
  "tipo_articulo*",
] as const;

const FIELD_LIMITS = {
  itemCode: 50,
  description: 500,
  itemGroup: 255,
  brand: 120,
  partNumber: 120,
} as const;

type Mode = "dry-run" | "apply";

type CliOptions = {
  mode: Mode;
  file: string;
  report?: string;
  sheetName?: string;
};

type RawExcelRow = Record<string, unknown>;

export type ParsedServiceRow = {
  rowNumber: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  brand: string | null;
  partNumber: string | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
};

export type SkippedRow = {
  rowNumber: number;
  reason: string;
  blocking: boolean;
  itemCode: string | null;
};

export type DuplicateCode = {
  itemCode: string;
  sourceRows: number[];
};

export type ExistingCatalogRow = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  brand: string | null;
  partNumber: string | null;
  tipoArticulo: number;
  allowsTaxWithholding: boolean;
  isActive: boolean;
};

type PlannedInsert = ParsedServiceRow & {
  tipoArticulo: 2;
};

type PlannedUpdate = ParsedServiceRow & {
  id: number;
  tipoArticulo: 2;
  previous: ExistingCatalogRow;
  changedFields: string[];
};

export type ImportPlan = {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  existingTypeConflicts: ExistingCatalogRow[];
};

type Verification = {
  importedCodesFound: number;
  importedCodesWithServiceType: number;
  totalServices: number;
  inventoryRowsForServiceCodes: number;
  assetsTotal: number;
  productsTotal: number;
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
    validationErrors: number;
    duplicateCodes: number;
    existingTypeConflicts: number;
    inserts: number;
    updates: number;
  };
  skippedRows: SkippedRow[];
  validationErrors: string[];
  duplicateCodes: DuplicateCode[];
  existingTypeConflicts: ExistingCatalogRow[];
  insertedRows: PlannedInsert[];
  updatedRows: PlannedUpdate[];
  applyResult?: {
    inserted: number;
    updated: number;
  };
  verification?: Verification;
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-services-hidalgo.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-services-hidalgo.ts --file <xlsx> --apply --report <json>",
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

function validateLength(
  errors: string[],
  rowNumber: number,
  field: string,
  value: string | null,
  limit: number
) {
  if (value && value.length > limit) {
    errors.push(
      `Fila ${rowNumber}: ${field} excede ${limit} caracteres (${value.length})`
    );
  }
}

function isBlankRow(row: RawExcelRow) {
  return Object.values(row).every(value => normalizeCell(value) === "");
}

function collectHeaders(rows: RawExcelRow[]) {
  const headers = new Set<string>();
  for (const row of rows) {
    for (const header of Object.keys(row)) headers.add(header);
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
    "grupo_sap",
    "marca",
    "numero_parte",
    "permite_retencion",
    "habilitado",
  ]);
  const unmappedColumns = headers.filter(header => !mappedHeaders.has(header));

  return {
    sheetName: selectedSheet,
    availableSheets: workbook.SheetNames,
    rawRows,
    missingHeaders,
    unmappedColumns,
  };
}

export function parseRows(
  rawRows: RawExcelRow[],
  options: { missingHeaders?: readonly string[] } = {}
) {
  const parsedRows: ParsedServiceRow[] = [];
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
      });
      return;
    }

    const itemCode = normalizeUpper(row["codigo_sap*"]);
    const description = normalizeCell(row["descripcion_servicio*"]);
    const articleType = normalizeUpper(row["tipo_articulo*"]);
    const allowsTaxWithholding = parseBoolean(row["permite_retencion"], true);
    const isActive = parseBoolean(row["habilitado"], true);
    const itemGroup = nullableText(row["grupo_sap"]);
    const brand = nullableText(row["marca"]);
    const partNumber = nullableText(row["numero_parte"]);

    if (!itemCode) {
      validationErrors.push(`Fila ${rowNumber}: codigo_sap* es requerido`);
    }
    if (!description) {
      validationErrors.push(
        `Fila ${rowNumber}: descripcion_servicio* es requerido`
      );
    }
    if (!["SERVICIO", "SERVICIOS", "SERVICE", "2"].includes(articleType)) {
      validationErrors.push(
        `Fila ${rowNumber}: tipo_articulo* debe ser SERVICIO`
      );
    }
    if (!allowsTaxWithholding.valid) {
      validationErrors.push(
        `Fila ${rowNumber}: permite_retencion debe ser SI/NO o verdadero/falso`
      );
    }
    if (!isActive.valid) {
      validationErrors.push(
        `Fila ${rowNumber}: habilitado debe ser SI/NO o verdadero/falso`
      );
    }

    validateLength(validationErrors, rowNumber, "codigo_sap*", itemCode, FIELD_LIMITS.itemCode);
    validateLength(
      validationErrors,
      rowNumber,
      "descripcion_servicio*",
      description,
      FIELD_LIMITS.description
    );
    validateLength(validationErrors, rowNumber, "grupo_sap", itemGroup, FIELD_LIMITS.itemGroup);
    validateLength(validationErrors, rowNumber, "marca", brand, FIELD_LIMITS.brand);
    validateLength(
      validationErrors,
      rowNumber,
      "numero_parte",
      partNumber,
      FIELD_LIMITS.partNumber
    );

    if (!itemCode || !description || !["SERVICIO", "SERVICIOS", "SERVICE", "2"].includes(articleType)) {
      skippedRows.push({
        rowNumber,
        reason: "Fila incompleta o tipo_articulo invalido",
        blocking: true,
        itemCode: itemCode || null,
      });
      return;
    }

    parsedRows.push({
      rowNumber,
      itemCode,
      description,
      itemGroup,
      brand,
      partNumber,
      allowsTaxWithholding: allowsTaxWithholding.value,
      isActive: isActive.value,
    });
  });

  return { parsedRows, skippedRows, validationErrors };
}

export function findDuplicateCodes(rows: ParsedServiceRow[]) {
  const rowsByCode = new Map<string, number[]>();
  for (const row of rows) {
    const sourceRows = rowsByCode.get(row.itemCode) ?? [];
    sourceRows.push(row.rowNumber);
    rowsByCode.set(row.itemCode, sourceRows);
  }

  return Array.from(rowsByCode.entries())
    .filter(([, sourceRows]) => sourceRows.length > 1)
    .map(([itemCode, sourceRows]) => ({ itemCode, sourceRows }));
}

function fieldValueForUpdate(
  nextValue: string | null,
  previousValue: string | null
) {
  return nextValue ?? previousValue;
}

function buildChangedFields(next: PlannedUpdate) {
  const previous = next.previous;
  const comparisons: Record<string, [unknown, unknown]> = {
    description: [next.description, previous.description],
    itemGroup: [next.itemGroup, previous.itemGroup],
    brand: [next.brand, previous.brand],
    partNumber: [next.partNumber, previous.partNumber],
    tipoArticulo: [next.tipoArticulo, previous.tipoArticulo],
    allowsTaxWithholding: [
      next.allowsTaxWithholding,
      previous.allowsTaxWithholding,
    ],
    isActive: [next.isActive, previous.isActive],
  };

  return Object.entries(comparisons)
    .filter(([, [nextValue, previousValue]]) => nextValue !== previousValue)
    .map(([field]) => field);
}

export function buildPlan(
  rows: ParsedServiceRow[],
  existingCatalogRows: ExistingCatalogRow[]
) {
  const existingByCode = new Map(
    existingCatalogRows.map(row => [row.itemCode, row])
  );
  const inserts: PlannedInsert[] = [];
  const updates: PlannedUpdate[] = [];
  const existingTypeConflicts: ExistingCatalogRow[] = [];

  for (const row of rows) {
    const existing = existingByCode.get(row.itemCode);
    if (existing && existing.tipoArticulo !== SERVICE_ARTICLE_TYPE) {
      existingTypeConflicts.push(existing);
      continue;
    }
    if (existing) {
      const update: PlannedUpdate = {
        ...row,
        itemGroup: fieldValueForUpdate(row.itemGroup, existing.itemGroup),
        brand: fieldValueForUpdate(row.brand, existing.brand),
        partNumber: fieldValueForUpdate(row.partNumber, existing.partNumber),
        id: existing.id,
        tipoArticulo: SERVICE_ARTICLE_TYPE,
        previous: existing,
        changedFields: [],
      };
      update.changedFields = buildChangedFields(update);
      updates.push(update);
      continue;
    }

    inserts.push({ ...row, tipoArticulo: SERVICE_ARTICLE_TYPE });
  }

  return { inserts, updates, existingTypeConflicts } satisfies ImportPlan;
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
              "allowsTaxWithholding",
              "isActive"
         from "sapCatalog"
        where "itemCode" = any($1::text[])`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return rows;
}

function toPayload(rows: Array<PlannedInsert | PlannedUpdate>) {
  return rows.map(row => ({
    itemCode: row.itemCode,
    description: row.description,
    itemGroup: row.itemGroup,
    brand: row.brand,
    partNumber: row.partNumber,
    tipoArticulo: row.tipoArticulo,
    allowsTaxWithholding: row.allowsTaxWithholding,
    isActive: row.isActive,
  }));
}

async function upsertServices(
  client: Client,
  rows: Array<PlannedInsert | PlannedUpdate>
) {
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
          "allowsTaxWithholding",
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
              x."allowsTaxWithholding",
              x."isActive",
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "itemCode" text,
           description text,
           "itemGroup" text,
           brand text,
           "partNumber" text,
           "tipoArticulo" integer,
           "allowsTaxWithholding" boolean,
           "isActive" boolean
         )
       on conflict ("itemCode") do update set
          description = excluded.description,
          "itemGroup" = coalesce(excluded."itemGroup", "sapCatalog"."itemGroup"),
          brand = coalesce(excluded.brand, "sapCatalog".brand),
          "partNumber" = coalesce(excluded."partNumber", "sapCatalog"."partNumber"),
          "tipoArticulo" = ${SERVICE_ARTICLE_TYPE},
          "projectId" = null,
          "allowsTaxWithholding" = excluded."allowsTaxWithholding",
          "isActive" = excluded."isActive",
          "updatedAt" = now()`,
      [JSON.stringify(toPayload(chunk))]
    );
    affected += chunk.length;
  }
  return affected;
}

async function applyPlan(client: Client, plan: ImportPlan) {
  await client.query("begin");
  try {
    const inserted = await upsertServices(client, plan.inserts);
    const updated = await upsertServices(client, plan.updates);
    await client.query("commit");
    return { inserted, updated };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function countScalar(client: Client, sqlText: string, params: unknown[] = []) {
  const result = await client.query<{ count: number }>(sqlText, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyImport(client: Client, rows: ParsedServiceRow[]) {
  const itemCodes = rows.map(row => row.itemCode);
  return {
    importedCodesFound: await countScalar(
      client,
      `select count(*)::int as count
         from "sapCatalog"
        where "itemCode" = any($1::text[])`,
      [itemCodes]
    ),
    importedCodesWithServiceType: await countScalar(
      client,
      `select count(*)::int as count
         from "sapCatalog"
        where "itemCode" = any($1::text[])
          and "tipoArticulo" = ${SERVICE_ARTICLE_TYPE}`,
      [itemCodes]
    ),
    totalServices: await countScalar(
      client,
      `select count(*)::int as count
         from "sapCatalog"
        where "tipoArticulo" = ${SERVICE_ARTICLE_TYPE}`
    ),
    inventoryRowsForServiceCodes: await countScalar(
      client,
      `select count(*)::int as count
         from "inventoryItems"
        where "sapItemCode" = any($1::text[])`,
      [itemCodes]
    ),
    assetsTotal: await countScalar(
      client,
      `select count(*)::int as count
         from "sapCatalog"
        where "tipoArticulo" = 3`
    ),
    productsTotal: await countScalar(
      client,
      `select count(*)::int as count
         from "sapCatalog"
        where "tipoArticulo" = 1`
    ),
  } satisfies Verification;
}

function validateForApply(params: {
  skippedRows: SkippedRow[];
  validationErrors: string[];
  duplicateCodes: DuplicateCode[];
  plan: ImportPlan;
}) {
  const errors = [
    ...params.validationErrors,
    ...params.skippedRows
      .filter(row => row.blocking)
      .map(row => `Fila ${row.rowNumber}: ${row.reason}`),
  ];
  if (params.duplicateCodes.length > 0) {
    errors.push(`${params.duplicateCodes.length} codigos duplicados`);
  }
  if (params.plan.existingTypeConflicts.length > 0) {
    errors.push(
      `${params.plan.existingTypeConflicts.length} codigos ya existen como producto o activo`
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
  parsedRows: ParsedServiceRow[];
  skippedRows: SkippedRow[];
  validationErrors: string[];
  duplicateCodes: DuplicateCode[];
  plan: ImportPlan;
  applyResult?: ImportReport["applyResult"];
  verification?: Verification;
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
      parsedRows: params.parsedRows.length,
      uniqueCodes: new Set(params.parsedRows.map(row => row.itemCode)).size,
      skippedRows: params.skippedRows.length,
      blockingSkippedRows: params.skippedRows.filter(row => row.blocking).length,
      validationErrors: params.validationErrors.length,
      duplicateCodes: params.duplicateCodes.length,
      existingTypeConflicts: params.plan.existingTypeConflicts.length,
      inserts: params.plan.inserts.length,
      updates: params.plan.updates.length,
    },
    skippedRows: params.skippedRows,
    validationErrors: params.validationErrors,
    duplicateCodes: params.duplicateCodes,
    existingTypeConflicts: params.plan.existingTypeConflicts,
    insertedRows: params.plan.inserts,
    updatedRows: params.plan.updates,
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
  console.log(`Servicios validos: ${report.summary.parsedRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Duplicados: ${report.summary.duplicateCodes}`);
  console.log(`Conflictos tipo existente: ${report.summary.existingTypeConflicts}`);
  console.log(`Validaciones: ${report.summary.validationErrors}`);
  console.log(`Servicios a insertar: ${report.summary.inserts}`);
  console.log(`Servicios a actualizar: ${report.summary.updates}`);
  if (report.applyResult) {
    console.log(`Servicios insertados: ${report.applyResult.inserted}`);
    console.log(`Servicios actualizados: ${report.applyResult.updated}`);
  }
  if (report.verification) {
    console.log(
      `Verificacion servicios tipo 2: ${report.verification.importedCodesWithServiceType}/${report.summary.uniqueCodes}`
    );
    console.log(
      `Inventario para servicios: ${report.verification.inventoryRowsForServiceCodes}`
    );
  }
}

async function run(options: CliOptions) {
  const workbook = readWorkbook(options.file, options.sheetName);
  const parsed = parseRows(workbook.rawRows, {
    missingHeaders: workbook.missingHeaders,
  });
  const duplicateCodes = findDuplicateCodes(parsed.parsedRows);
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    const existingCatalogRows = await loadExistingCatalogRows(
      client,
      parsed.parsedRows.map(row => row.itemCode)
    );
    const plan = buildPlan(parsed.parsedRows, existingCatalogRows);
    const blockingErrors = validateForApply({
      skippedRows: parsed.skippedRows,
      validationErrors: parsed.validationErrors,
      duplicateCodes,
      plan,
    });

    let applyResult: ImportReport["applyResult"] | undefined;
    let verification: Verification | undefined;
    if (options.mode === "apply") {
      if (blockingErrors.length > 0) {
        throw new Error(
          `No se puede aplicar la carga por errores bloqueantes:\n${blockingErrors
            .slice(0, 20)
            .join("\n")}`
        );
      }
      applyResult = await applyPlan(client, plan);
      verification = await verifyImport(client, parsed.parsedRows);
    }

    const report = buildReport({
      mode: options.mode,
      file: options.file,
      sheetName: workbook.sheetName,
      availableSheets: workbook.availableSheets,
      rawRows: workbook.rawRows.length,
      unmappedColumns: workbook.unmappedColumns,
      parsedRows: parsed.parsedRows,
      skippedRows: parsed.skippedRows,
      validationErrors: parsed.validationErrors,
      duplicateCodes,
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

