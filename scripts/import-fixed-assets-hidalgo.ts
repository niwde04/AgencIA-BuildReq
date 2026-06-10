import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { Client } from "pg";
import XLSX from "xlsx";

const SHEET_NAME = "Hoja1";
const BATCH_SIZE = 500;
const REQUIRED_HEADERS = [
  "Codigo Proyecto",
  "Nombre Proyecto",
  "Numero de articulo",
  "Tipo de articulo",
  "Descripcion del articulo",
  "Grupo SAP",
] as const;

type Mode = "dry-run" | "apply";

type CliOptions = {
  mode: Mode;
  file: string;
  report?: string;
};

type RawExcelRow = Record<string, unknown>;

type ProjectRef = {
  id: number;
  code: string;
  name: string;
};

type ExistingAssetRow = {
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

type SkippedRow = {
  rowNumber: number;
  reason: string;
  itemCode: string | null;
  projectCode: string | null;
  tipoArticulo: string | null;
  description: string | null;
};

type ParsedAssetRow = {
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
};

type ResolvedAssetRow = ParsedAssetRow & {
  project: ProjectRef | null;
  projectId: number | null;
};

type DuplicateCode = {
  itemCode: string;
  sourceRows: number[];
};

type MissingProject = {
  projectCode: string;
  projectKey: string;
  projectName: string | null;
  rows: number[];
};

type PlannedUpdate = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string;
  tipoArticulo: 3;
  projectId: number | null;
  isActive: true;
  sourceRow: number;
  projectCodeRaw: string | null;
  projectNameRaw: string | null;
  previous: ExistingAssetRow;
  descriptionChanged: boolean;
  itemGroupChanged: boolean;
  projectChanged: boolean;
  typeChanged: boolean;
  activeChanged: boolean;
};

type PlannedInsert = {
  itemCode: string;
  description: string;
  itemGroup: string;
  tipoArticulo: 3;
  projectId: number | null;
  allowsTaxWithholding: true;
  isActive: true;
  sourceRow: number;
  projectCodeRaw: string | null;
  projectNameRaw: string | null;
};

type AppliedInsert = {
  id: number;
  itemCode: string;
};

type ImportPlan = {
  updates: PlannedUpdate[];
  inserts: PlannedInsert[];
};

type ProjectSummary = {
  projectId: number | null;
  projectCode: string | null;
  projectName: string | null;
  rows: number;
};

type Verification = {
  importedCodesFound: number;
  importedCodesWithAssetType: number;
  missingImportedCodes: string[];
  nonAssetRows: Array<{ itemCode: string; tipoArticulo: number }>;
  descriptionMismatches: Array<{
    itemCode: string;
    expected: string;
    actual: string;
  }>;
  itemGroupMismatches: Array<{
    itemCode: string;
    expected: string;
    actual: string | null;
  }>;
  projectSummary: ProjectSummary[];
};

type ImportReport = {
  generatedAt: string;
  mode: Mode;
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
    missingProjects: number;
    existingRows: number;
    updates: number;
    inserts: number;
    descriptionChanges: number;
    itemGroupChanges: number;
    projectChanges: number;
    typeCorrections: number;
    activatedRows: number;
  };
  applyResult?: {
    updated: number;
    inserted: number;
  };
  projectSummary: ProjectSummary[];
  skippedRows: SkippedRow[];
  duplicateCodes: DuplicateCode[];
  missingProjects: MissingProject[];
  updatedRows: PlannedUpdate[];
  insertedRows: Array<PlannedInsert & { id?: number }>;
  verification?: Verification;
};

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx scripts/import-fixed-assets-hidalgo.ts --file <xlsx> --dry-run --report <json>",
      "  pnpm exec tsx scripts/import-fixed-assets-hidalgo.ts --file <xlsx> --apply --report <json>",
    ].join("\n")
  );
}

function parseArgs(argv: string[]): CliOptions {
  let mode: Mode | undefined;
  let file: string | undefined;
  let report: string | undefined;

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
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  if (!mode) throw new Error("Debe indicar --dry-run o --apply");
  if (!file) throw new Error("Debe indicar --file <xlsx>");
  return { mode, file, report };
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function normalizeLookup(value: unknown) {
  return normalizeCell(value)
    .replace(/\s+/g, " ")
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

function isBlankExcelRow(row: RawExcelRow) {
  return [
    "Codigo Proyecto",
    "Nombre Proyecto",
    "Codigo de almacen",
    "Nombre de almacen",
    "Numero de articulo",
    "Tipo de articulo",
    "Descripcion del articulo",
  ].every(header => normalizeCell(row[header]) === "");
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
  const parsedRows: ParsedAssetRow[] = [];
  const skippedRows: SkippedRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankExcelRow(row)) continue;

    const rowNumber = index + 2;
    const itemCode = normalizeCell(row["Numero de articulo"]);
    const description = normalizeCell(row["Descripcion del articulo"]);
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

    if (!itemCode) {
      skippedRows.push({ ...baseSkipped, reason: "Sin Numero de articulo" });
      continue;
    }

    if (!description) {
      skippedRows.push({ ...baseSkipped, reason: "Sin Descripcion del articulo" });
      continue;
    }

    if (description.length > 500) {
      skippedRows.push({
        ...baseSkipped,
        reason: "Descripcion excede 500 caracteres",
      });
      continue;
    }

    if (tipoArticulo !== "ACTIVO") {
      skippedRows.push({
        ...baseSkipped,
        reason: "Tipo de articulo no es ACTIVO",
      });
      continue;
    }

    if (!itemGroup) {
      skippedRows.push({
        ...baseSkipped,
        reason: "Sin Grupo SAP",
      });
      continue;
    }

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
    });
  }

  return { parsedRows, skippedRows };
}

function findDuplicateCodes(rows: ParsedAssetRow[]) {
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

function buildProjectLookup(projects: ProjectRef[]) {
  const lookup = new Map<string, ProjectRef>();
  for (const project of projects) {
    lookup.set(normalizeProjectKey(project.code), project);
  }
  return lookup;
}

function resolveProjects(rows: ParsedAssetRow[], projectLookup: Map<string, ProjectRef>) {
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
              "fixedAssetCondition",
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

function buildPlan(rows: ResolvedAssetRow[], existingAssets: ExistingAssetRow[]) {
  const existingByCode = new Map(existingAssets.map(row => [row.itemCode, row]));
  const updates: PlannedUpdate[] = [];
  const inserts: PlannedInsert[] = [];

  for (const row of rows) {
    const existing = existingByCode.get(row.itemCode);
    if (existing) {
      updates.push({
        id: existing.id,
        itemCode: row.itemCode,
        description: row.description,
        itemGroup: row.itemGroup,
        tipoArticulo: 3,
        projectId: row.projectId,
        isActive: true,
        sourceRow: row.rowNumber,
        projectCodeRaw: row.projectCodeRaw,
        projectNameRaw: row.projectNameRaw,
        previous: existing,
        descriptionChanged: existing.description !== row.description,
        itemGroupChanged: (existing.itemGroup ?? null) !== row.itemGroup,
        projectChanged: (existing.projectId ?? null) !== row.projectId,
        typeChanged: existing.tipoArticulo !== 3,
        activeChanged: existing.isActive !== true,
      });
      continue;
    }

    inserts.push({
      itemCode: row.itemCode,
      description: row.description,
      itemGroup: row.itemGroup,
      tipoArticulo: 3,
      projectId: row.projectId,
      allowsTaxWithholding: true,
      isActive: true,
      sourceRow: row.rowNumber,
      projectCodeRaw: row.projectCodeRaw,
      projectNameRaw: row.projectNameRaw,
    });
  }

  return { updates, inserts } satisfies ImportPlan;
}

function summarizeByProject(rows: Array<{ projectId: number | null; project?: ProjectRef | null }>) {
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
              "isActive" = true,
              "updatedAt" = now()
         from jsonb_to_recordset($1::jsonb) as x(
           id integer,
           description text,
           "itemGroup" text,
           "projectId" integer
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
          "updatedAt"
        )
       select x."itemCode",
              x.description,
              x."itemGroup",
              3,
              x."projectId",
              true,
              true,
              now()
         from jsonb_to_recordset($1::jsonb) as x(
           "itemCode" text,
           description text,
           "itemGroup" text,
           "projectId" integer
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

async function verifyImport(client: Client, rows: ResolvedAssetRow[]) {
  const itemCodes = rows.map(row => row.itemCode);
  const expectedByCode = new Map(rows.map(row => [row.itemCode, row]));
  const dbRows: Array<{
    itemCode: string;
    description: string;
    itemGroup: string | null;
    tipoArticulo: number;
    projectId: number | null;
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
  const descriptionMismatches = dbRows
    .map(row => {
      const expected = expectedByCode.get(row.itemCode);
      if (!expected || expected.description === row.description) return null;
      return {
        itemCode: row.itemCode,
        expected: expected.description,
        actual: row.description,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const itemGroupMismatches = dbRows
    .map(row => {
      const expected = expectedByCode.get(row.itemCode);
      if (!expected || expected.itemGroup === row.itemGroup) return null;
      return {
        itemCode: row.itemCode,
        expected: expected.itemGroup,
        actual: row.itemGroup,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
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
    descriptionMismatches,
    itemGroupMismatches,
    projectSummary,
  } satisfies Verification;
}

function buildReport(params: {
  mode: Mode;
  file: string;
  rawRows: number;
  parsedRows: ParsedAssetRow[];
  skippedRows: SkippedRow[];
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
      sheetName: SHEET_NAME,
      rawRows: params.rawRows,
    },
    summary: {
      rawRows: params.rawRows,
      parsedRows: params.parsedRows.length,
      uniqueCodes: new Set(params.parsedRows.map(row => row.itemCode)).size,
      skippedRows: params.skippedRows.length,
      duplicateCodes: params.duplicateCodes.length,
      missingProjects: params.missingProjects.length,
      existingRows: params.plan.updates.length,
      updates: params.plan.updates.length,
      inserts: params.plan.inserts.length,
      descriptionChanges: params.plan.updates.filter(row => row.descriptionChanged).length,
      itemGroupChanges: params.plan.updates.filter(row => row.itemGroupChanged).length,
      projectChanges: params.plan.updates.filter(row => row.projectChanged).length,
      typeCorrections: params.plan.updates.filter(row => row.typeChanged).length,
      activatedRows: params.plan.updates.filter(row => row.activeChanged).length,
    },
    applyResult: params.applyResult,
    projectSummary: summarizeByProject(params.resolvedRows),
    skippedRows: params.skippedRows,
    duplicateCodes: params.duplicateCodes,
    missingProjects: params.missingProjects,
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
  console.log(`Filas Excel: ${report.summary.rawRows}`);
  console.log(`Filas validas: ${report.summary.parsedRows}`);
  console.log(`Codigos unicos: ${report.summary.uniqueCodes}`);
  console.log(`Filas omitidas: ${report.summary.skippedRows}`);
  console.log(`Codigos duplicados: ${report.summary.duplicateCodes}`);
  console.log(`Proyectos sin empatar: ${report.summary.missingProjects}`);
  console.log(`Actualizaciones: ${report.summary.updates}`);
  console.log(`Inserciones: ${report.summary.inserts}`);
  console.log(`Cambios de descripcion: ${report.summary.descriptionChanges}`);
  console.log(`Cambios de grupo SAP: ${report.summary.itemGroupChanges}`);
  console.log(`Cambios de proyecto: ${report.summary.projectChanges}`);
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
      `Verificacion - descripciones distintas: ${report.verification.descriptionMismatches.length}`
    );
    console.log(
      `Verificacion - grupos SAP distintos: ${report.verification.itemGroupMismatches.length}`
    );
  }
}

async function buildImportPlan(client: Client, file: string) {
  const workbook = readWorkbook(file);
  const { parsedRows, skippedRows } = parseRows(workbook.rawRows);
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
    rawRows: workbook.rawRows.length,
    parsedRows,
    skippedRows,
    duplicateCodes,
    missingProjects,
    resolvedRows,
    plan,
  };
}

function assertPlanCanApply(planData: Awaited<ReturnType<typeof buildImportPlan>>) {
  const problems: string[] = [];
  if (planData.skippedRows.length > 0) {
    problems.push(`${planData.skippedRows.length} filas omitidas`);
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
    const planData = await buildImportPlan(client, options.file);
    let applyResult: ImportReport["applyResult"] | undefined;
    let insertedRows: AppliedInsert[] | undefined;
    let verification: Verification | undefined;

    if (options.mode === "apply") {
      assertPlanCanApply(planData);
      const applied = await applyImport(client, planData.plan);
      applyResult = applied.result;
      insertedRows = applied.insertedRows;
      verification = await verifyImport(client, planData.resolvedRows);
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

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
