import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const SHEET_NAME = "Hoja1";
const BATCH_SIZE = 500;
const REQUIRED_HEADERS = [
  "Numero de articulo",
  "MARCA",
  "CODIGO SKU NP",
] as const;

type Mode = "dry-run" | "apply";
type ConflictPolicy = "first";

type CliOptions = {
  mode: Mode;
  file: string;
  report?: string;
  conflictPolicy: ConflictPolicy;
};

type RawExcelRow = Record<string, unknown>;

type ParsedRow = {
  rowNumber: number;
  itemCode: string;
  brand: string | null;
  partNumber: string | null;
};

type SkippedRow = {
  rowNumber: number;
  reason: string;
  itemCode: string | null;
  brand: string | null;
  partNumber: string | null;
};

type DuplicateGroup = {
  itemCode: string;
  sourceRows: number[];
  selectedRow: number;
  selectedBrand: string | null;
  selectedPartNumber: string | null;
  hasConflict: boolean;
  values: Array<{
    rowNumber: number;
    brand: string | null;
    partNumber: string | null;
  }>;
};

type GroupedRow = ParsedRow & {
  duplicateRows: number[];
};

type ExistingCatalogRow = {
  id: number;
  itemCode: string;
  description: string;
  brand: string | null;
  partNumber: string | null;
};

type PlannedUpdate = {
  id: number;
  itemCode: string;
  brand: string | null;
  partNumber: string | null;
  sourceRow: number;
  duplicateRows: number[];
  previous: ExistingCatalogRow;
  brandChanged: boolean;
  partNumberChanged: boolean;
};

type Verification = {
  importedCodesFound: number;
  brandMismatches: Array<{
    itemCode: string;
    expected: string | null;
    actual: string | null;
  }>;
  partNumberMismatches: Array<{
    itemCode: string;
    expected: string | null;
    actual: string | null;
  }>;
};

type ImportReport = {
  generatedAt: string;
  mode: Mode;
  conflictPolicy: ConflictPolicy;
  source: {
    file: string;
    sheetName: string;
    rawRows: number;
  };
  summary: {
    rawRows: number;
    parsedRows: number;
    uniqueCodes: number;
    skippedRows: number;
    duplicateCodes: number;
    conflictingDuplicateCodes: number;
    missingCatalogCodes: number;
    updates: number;
    brandChanges: number;
    partNumberChanges: number;
  };
  applyResult?: {
    updated: number;
  };
  skippedRows: SkippedRow[];
  duplicateGroups: DuplicateGroup[];
  missingCatalogCodes: string[];
  updatedRows: PlannedUpdate[];
  verification?: Verification;
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-article-brand-sku.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-article-brand-sku.ts --file <xlsx> --apply --report <json>",
    ].join("\n")
  );
}

function parseArgs(argv: string[]): CliOptions {
  let mode: Mode | undefined;
  let file: string | undefined;
  let report: string | undefined;
  let conflictPolicy: ConflictPolicy = "first";

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
    } else if (arg === "--conflict-policy") {
      const value = argv[index + 1];
      if (value !== "first") {
        throw new Error("Solo se soporta --conflict-policy first");
      }
      conflictPolicy = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  if (!mode) throw new Error("Debe indicar --dry-run o --apply");
  if (!file) throw new Error("Debe indicar --file <xlsx>");
  return { mode, file, report, conflictPolicy };
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function toNullableText(value: unknown) {
  const text = normalizeCell(value);
  return text || null;
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

function readWorkbook(file: string) {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const worksheet = workbook.Sheets[SHEET_NAME];
  if (!worksheet) throw new Error(`No se encontro la hoja ${SHEET_NAME}`);

  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const actualHeaders = new Set((headerRows[0] ?? []).map(normalizeCell));
  const missingHeaders = REQUIRED_HEADERS.filter(header => !actualHeaders.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Faltan encabezados requeridos: ${missingHeaders.join(", ")}`);
  }

  const rows = XLSX.utils.sheet_to_json<RawExcelRow>(worksheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });

  return { file, rawRows: rows };
}

function parseRows(rows: RawExcelRow[]) {
  const parsedRows: ParsedRow[] = [];
  const skippedRows: SkippedRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const itemCode = normalizeCell(row["Numero de articulo"]);
    const brand = toNullableText(row.MARCA);
    const partNumber = toNullableText(row["CODIGO SKU NP"]);

    if (!itemCode) {
      skippedRows.push({
        rowNumber,
        reason: "Sin Numero de articulo",
        itemCode: null,
        brand,
        partNumber,
      });
      continue;
    }

    if ((brand?.length ?? 0) > 120) {
      skippedRows.push({
        rowNumber,
        reason: "MARCA excede 120 caracteres",
        itemCode,
        brand,
        partNumber,
      });
      continue;
    }

    if ((partNumber?.length ?? 0) > 120) {
      skippedRows.push({
        rowNumber,
        reason: "CODIGO SKU NP excede 120 caracteres",
        itemCode,
        brand,
        partNumber,
      });
      continue;
    }

    parsedRows.push({ rowNumber, itemCode, brand, partNumber });
  }

  return { parsedRows, skippedRows };
}

function groupRows(rows: ParsedRow[], conflictPolicy: ConflictPolicy) {
  const rowsByCode = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const bucket = rowsByCode.get(row.itemCode) ?? [];
    bucket.push(row);
    rowsByCode.set(row.itemCode, bucket);
  }

  const groupedRows: GroupedRow[] = [];
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [itemCode, bucket] of Array.from(rowsByCode.entries())) {
    const selected = conflictPolicy === "first" ? bucket[0] : bucket[0];
    groupedRows.push({
      ...selected,
      duplicateRows: bucket.slice(1).map((row: ParsedRow) => row.rowNumber),
    });

    if (bucket.length <= 1) continue;
    const selectedKey = JSON.stringify([selected.brand, selected.partNumber]);
    const hasConflict = bucket.some(
      (row: ParsedRow) =>
        JSON.stringify([row.brand, row.partNumber]) !== selectedKey
    );
    duplicateGroups.push({
      itemCode,
      sourceRows: bucket.map((row: ParsedRow) => row.rowNumber),
      selectedRow: selected.rowNumber,
      selectedBrand: selected.brand,
      selectedPartNumber: selected.partNumber,
      hasConflict,
      values: bucket.map((row: ParsedRow) => ({
        rowNumber: row.rowNumber,
        brand: row.brand,
        partNumber: row.partNumber,
      })),
    });
  }

  return {
    groupedRows: groupedRows.sort((left, right) =>
      left.itemCode.localeCompare(right.itemCode)
    ),
    duplicateGroups: duplicateGroups.sort((left, right) =>
      left.itemCode.localeCompare(right.itemCode)
    ),
  };
}

async function loadCatalog(client: Client, itemCodes: string[]) {
  const rows: ExistingCatalogRow[] = [];
  const uniqueCodes = Array.from(new Set(itemCodes));
  for (const chunk of chunkItems(uniqueCodes, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query<ExistingCatalogRow>(
      `select id,
              "itemCode",
              description,
              brand,
              "partNumber"
         from "sapCatalog"
        where "itemCode" = any($1::text[])
        order by "itemCode"`,
      [chunk]
    );
    rows.push(...result.rows);
  }
  return rows;
}

function buildPlan(groupedRows: GroupedRow[], existingRows: ExistingCatalogRow[]) {
  const existingByCode = new Map(existingRows.map(row => [row.itemCode, row]));
  const updates: PlannedUpdate[] = [];
  const missingCatalogCodes: string[] = [];

  for (const row of groupedRows) {
    const existing = existingByCode.get(row.itemCode);
    if (!existing) {
      missingCatalogCodes.push(row.itemCode);
      continue;
    }

    updates.push({
      id: existing.id,
      itemCode: row.itemCode,
      brand: row.brand,
      partNumber: row.partNumber,
      sourceRow: row.rowNumber,
      duplicateRows: row.duplicateRows,
      previous: existing,
      brandChanged: (existing.brand ?? null) !== row.brand,
      partNumberChanged: (existing.partNumber ?? null) !== row.partNumber,
    });
  }

  return {
    updates,
    missingCatalogCodes: missingCatalogCodes.sort(),
  };
}

async function updateCatalogRows(client: Client, rows: PlannedUpdate[]) {
  let updated = 0;
  for (const chunk of chunkItems(rows, BATCH_SIZE)) {
    if (chunk.length === 0) continue;
    const result = await client.query(
      `update "sapCatalog" as catalog
          set brand = x.brand,
              "partNumber" = x."partNumber",
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           brand text,
           "partNumber" text
         )
        where catalog.id = x.id`,
      [JSON.stringify(chunk)]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

async function applyImport(client: Client, rows: PlannedUpdate[]) {
  await client.query("begin");
  try {
    const updated = await updateCatalogRows(client, rows);
    await client.query("commit");
    return { updated };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function verifyImport(client: Client, updates: PlannedUpdate[]) {
  const itemCodes = updates.map(row => row.itemCode);
  const expectedByCode = new Map(updates.map(row => [row.itemCode, row]));
  const dbRows = await loadCatalog(client, itemCodes);

  const brandMismatches = dbRows
    .map(row => {
      const expected = expectedByCode.get(row.itemCode);
      if (!expected || (row.brand ?? null) === expected.brand) return null;
      return {
        itemCode: row.itemCode,
        expected: expected.brand,
        actual: row.brand ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const partNumberMismatches = dbRows
    .map(row => {
      const expected = expectedByCode.get(row.itemCode);
      if (!expected || (row.partNumber ?? null) === expected.partNumber) return null;
      return {
        itemCode: row.itemCode,
        expected: expected.partNumber,
        actual: row.partNumber ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    importedCodesFound: dbRows.length,
    brandMismatches,
    partNumberMismatches,
  } satisfies Verification;
}

function buildReport(params: {
  mode: Mode;
  conflictPolicy: ConflictPolicy;
  file: string;
  rawRows: number;
  parsedRows: ParsedRow[];
  skippedRows: SkippedRow[];
  duplicateGroups: DuplicateGroup[];
  missingCatalogCodes: string[];
  updates: PlannedUpdate[];
  applyResult?: ImportReport["applyResult"];
  verification?: Verification;
}) {
  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    conflictPolicy: params.conflictPolicy,
    source: {
      file: params.file,
      sheetName: SHEET_NAME,
      rawRows: params.rawRows,
    },
    summary: {
      rawRows: params.rawRows,
      parsedRows: params.parsedRows.length,
      uniqueCodes: new Set(params.parsedRows.map(row => row.itemCode)).size,
      skippedRows: params.skippedRows.length,
      duplicateCodes: params.duplicateGroups.length,
      conflictingDuplicateCodes: params.duplicateGroups.filter(group => group.hasConflict)
        .length,
      missingCatalogCodes: params.missingCatalogCodes.length,
      updates: params.updates.length,
      brandChanges: params.updates.filter(row => row.brandChanged).length,
      partNumberChanges: params.updates.filter(row => row.partNumberChanged).length,
    },
    applyResult: params.applyResult,
    skippedRows: params.skippedRows,
    duplicateGroups: params.duplicateGroups,
    missingCatalogCodes: params.missingCatalogCodes,
    updatedRows: params.updates,
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
  console.log(`Filas Excel: ${report.summary.rawRows}`);
  console.log(`Filas validas: ${report.summary.parsedRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Filas omitidas: ${report.summary.skippedRows}`);
  console.log(`Codigos duplicados: ${report.summary.duplicateCodes}`);
  console.log(`Duplicados con conflicto: ${report.summary.conflictingDuplicateCodes}`);
  console.log(`Codigos sin catalogo: ${report.summary.missingCatalogCodes}`);
  console.log(`Actualizaciones: ${report.summary.updates}`);
  console.log(`Cambios de marca: ${report.summary.brandChanges}`);
  console.log(`Cambios de SKU/No. parte: ${report.summary.partNumberChanges}`);
  console.log(`Politica de duplicados: ${report.conflictPolicy}`);
  if (report.applyResult) {
    console.log(`Aplicado - actualizadas: ${report.applyResult.updated}`);
  }
  if (report.verification) {
    console.log(`Verificacion - codigos encontrados: ${report.verification.importedCodesFound}`);
    console.log(
      `Verificacion - marcas distintas: ${report.verification.brandMismatches.length}`
    );
    console.log(
      `Verificacion - SKU/No. parte distintos: ${report.verification.partNumberMismatches.length}`
    );
  }
}

async function buildImportPlan(client: Client, options: CliOptions) {
  const workbook = readWorkbook(options.file);
  const { parsedRows, skippedRows } = parseRows(workbook.rawRows);
  const { groupedRows, duplicateGroups } = groupRows(
    parsedRows,
    options.conflictPolicy
  );
  const existingRows = await loadCatalog(
    client,
    groupedRows.map(row => row.itemCode)
  );
  const { updates, missingCatalogCodes } = buildPlan(groupedRows, existingRows);

  return {
    file: workbook.file,
    rawRows: workbook.rawRows.length,
    parsedRows,
    skippedRows,
    duplicateGroups,
    updates,
    missingCatalogCodes,
  };
}

function assertPlanCanApply(planData: Awaited<ReturnType<typeof buildImportPlan>>) {
  const problems: string[] = [];
  const hardSkippedRows = planData.skippedRows.filter(row => row.reason !== "Sin Numero de articulo");
  if (hardSkippedRows.length > 0) {
    problems.push(`${hardSkippedRows.length} filas invalidas`);
  }
  if (planData.missingCatalogCodes.length > 0) {
    problems.push(`${planData.missingCatalogCodes.length} codigos sin catalogo`);
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
    const planData = await buildImportPlan(client, options);
    let applyResult: ImportReport["applyResult"] | undefined;
    let verification: Verification | undefined;

    if (options.mode === "apply") {
      assertPlanCanApply(planData);
      applyResult = await applyImport(client, planData.updates);
      verification = await verifyImport(client, planData.updates);
    }

    const report = buildReport({
      mode: options.mode,
      conflictPolicy: options.conflictPolicy,
      ...planData,
      applyResult,
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

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
