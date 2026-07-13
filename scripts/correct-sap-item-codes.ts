import "dotenv/config";

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client, type PoolClient } from "pg";

const execFileAsync = promisify(execFile);

const DEFAULT_BACKUP_DIR = "backups";
const DEFAULT_REPORT_DIR = "reports/sap-code-corrections";
const BATCH_SIZE = 500;

type RunMode = "dry-run" | "apply";

type CliOptions = {
  mode: RunMode;
  reportPath: string | null;
  backupDir: string;
  pgDumpPath: string;
  help: boolean;
};

type SapCodeMapping = {
  bad: string;
  good: string;
  description: string;
};

type CatalogRow = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  financialGroupCode: string | null;
  brand: string | null;
  partNumber: string | null;
  tipoArticulo: number;
  isActive: boolean;
  createdById: number | null;
  updatedById: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type CodeCount = {
  code: string;
  count: number;
};

type TableColumnCount = {
  table: string;
  column: string;
  rows: CodeCount[];
};

type MappingStatus = {
  bad: string;
  good: string;
  description: string;
  badCatalog: CatalogRow | null;
  goodCatalog: CatalogRow | null;
  references: Array<{
    table: string;
    column: string;
    badCount: number;
    goodCount: number;
  }>;
};

type AffectedDocuments = {
  purchaseRequestIds: number[];
  purchaseOrderIds: number[];
};

type Snapshot = {
  generatedAt: string;
  mappings: MappingStatus[];
  tableColumnCounts: TableColumnCount[];
  details: Record<string, unknown[]>;
  affectedDocuments: AffectedDocuments;
};

type ValidationResult = {
  errors: string[];
};

type ApplyResult = {
  updatedRows: Record<string, number>;
  invalidatedDocuments: {
    purchaseRequests: number;
    purchaseOrders: number;
  };
};

type Verification = {
  goodCatalogCodesFound: number;
  badCatalogCodesRemaining: number;
  badReferencesRemaining: number;
  badReferences: TableColumnCount[];
};

type CorrectionReport = {
  generatedAt: string;
  mode: RunMode;
  backupPath: string | null;
  snapshotPath: string | null;
  summary: {
    mappings: number;
    badCatalogCodesFound: number;
    goodCatalogConflicts: number;
    badReferences: number;
    purchaseRequestsToInvalidate: number;
    purchaseOrdersToInvalidate: number;
    validationErrors: number;
  };
  validationErrors: string[];
  before: Snapshot;
  applyResult?: ApplyResult;
  verification?: Verification;
};

const SAP_CODE_MAPPINGS: SapCodeMapping[] = [
  { bad: "F15900", good: "050200609", description: "ALFOMBRA/GRAMA VERDE" },
  {
    bad: "SNP22253",
    good: "050200610",
    description: "MADERA RUSTICA 2X4X16FT",
  },
  { bad: "SNP6547863", good: "050200611", description: "CUERDA P/ALBANIL" },
  { bad: "SNP75166", good: "050200612", description: "TUBO PVC PRESION 10" },
  { bad: "200457", good: "050400131", description: "ACERO PLASTICO" },
  { bad: "SPN36985", good: "050400132", description: "SUPER GLUE" },
  { bad: "4004800049", good: "090200896", description: "FILTRO HIDRAULICO" },
  { bad: "P551210", good: "090200897", description: "FILTRO HIDRAULICO" },
  {
    bad: "B60170005910",
    good: "090503798",
    description: "SELLO DE RUEDAS DELANTERO",
  },
  {
    bad: "SNP185164483",
    good: "090503799",
    description: "RADIATOR C/ MARCO GU, MOTOR",
  },
];

const TRACKED_REFERENCES = [
  { table: "requestItems", column: "sapItemCode" },
  { table: "purchaseRequestItems", column: "originalSapItemCode" },
  { table: "purchaseRequestItems", column: "currentSapItemCode" },
  { table: "purchaseOrderItems", column: "originalSapItemCode" },
  { table: "purchaseOrderItems", column: "currentSapItemCode" },
  { table: "receiptItems", column: "sapItemCode" },
  { table: "invoiceItems", column: "originalSapItemCode" },
  { table: "invoiceItems", column: "currentSapItemCode" },
  { table: "inventoryItems", column: "sapItemCode" },
  { table: "sapCatalog", column: "itemCode" },
] as const;

function readValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta valor para ${flag}`);
  }
  return value;
}

export function parseSapCodeCorrectionArgs(
  args = process.argv.slice(2)
): CliOptions {
  let mode: RunMode = "dry-run";
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
    if (arg === "--dry-run") {
      mode = "dry-run";
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
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

  return { mode, reportPath, backupDir, pgDumpPath, help };
}

function formatTimestamp(date: Date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function chunkItems<T>(items: T[], size = BATCH_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getBadCodes() {
  return SAP_CODE_MAPPINGS.map(mapping => mapping.bad);
}

function getGoodCodes() {
  return SAP_CODE_MAPPINGS.map(mapping => mapping.good);
}

function getAllCodes() {
  return Array.from(new Set([...getBadCodes(), ...getGoodCodes()]));
}

function getMappedCodeExpression(columnName: string) {
  return `
    (select mapping.good
       from jsonb_to_recordset($1::jsonb) as mapping(bad text, good text)
      where mapping.bad = ${quoteIdentifier(columnName)}
      limit 1)
  `;
}

async function loadCatalogRows(client: Client | PoolClient, itemCodes: string[]) {
  const rows: CatalogRow[] = [];
  for (const chunk of chunkItems(Array.from(new Set(itemCodes)))) {
    if (chunk.length === 0) continue;
    const result = await client.query<CatalogRow>(
      `select id,
              "itemCode",
              description,
              "itemGroup",
              "financialGroupCode",
              brand,
              "partNumber",
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

async function loadReferenceCounts(client: Client | PoolClient, codes: string[]) {
  const counts: TableColumnCount[] = [];

  for (const reference of TRACKED_REFERENCES) {
    const result = await client.query<CodeCount>(
      `select ${quoteIdentifier(reference.column)} as code,
              count(*)::int as count
         from ${quoteIdentifier(reference.table)}
        where ${quoteIdentifier(reference.column)} = any($1::text[])
        group by ${quoteIdentifier(reference.column)}
        order by ${quoteIdentifier(reference.column)}`,
      [codes]
    );

    if (result.rows.length > 0) {
      counts.push({
        table: reference.table,
        column: reference.column,
        rows: result.rows,
      });
    }
  }

  return counts;
}

function buildMappingStatuses(
  catalogRows: CatalogRow[],
  tableColumnCounts: TableColumnCount[]
) {
  const catalogByCode = new Map(catalogRows.map(row => [row.itemCode, row]));

  return SAP_CODE_MAPPINGS.map(mapping => {
    const references = tableColumnCounts
      .map(entry => {
        const badCount =
          entry.rows.find(row => row.code === mapping.bad)?.count ?? 0;
        const goodCount =
          entry.rows.find(row => row.code === mapping.good)?.count ?? 0;
        if (!badCount && !goodCount) return null;
        return {
          table: entry.table,
          column: entry.column,
          badCount,
          goodCount,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      bad: mapping.bad,
      good: mapping.good,
      description: mapping.description,
      badCatalog: catalogByCode.get(mapping.bad) ?? null,
      goodCatalog: catalogByCode.get(mapping.good) ?? null,
      references,
    };
  });
}

async function loadAffectedDocuments(
  client: Client | PoolClient,
  badCodes: string[]
): Promise<AffectedDocuments> {
  const purchaseRequests = await client.query<{ id: number }>(
    `select distinct "purchaseRequestId" as id
       from "purchaseRequestItems"
      where "purchaseRequestId" is not null
        and (
          "originalSapItemCode" = any($1::text[])
          or "currentSapItemCode" = any($1::text[])
        )
      order by "purchaseRequestId"`,
    [badCodes]
  );
  const purchaseOrders = await client.query<{ id: number }>(
    `select distinct "purchaseOrderId" as id
       from "purchaseOrderItems"
      where "purchaseOrderId" is not null
        and (
          "originalSapItemCode" = any($1::text[])
          or "currentSapItemCode" = any($1::text[])
        )
      order by "purchaseOrderId"`,
    [badCodes]
  );

  return {
    purchaseRequestIds: purchaseRequests.rows.map(row => row.id),
    purchaseOrderIds: purchaseOrders.rows.map(row => row.id),
  };
}

async function loadSnapshotDetails(client: Client | PoolClient, badCodes: string[]) {
  const details: Record<string, unknown[]> = {};

  details.sapCatalog = (
    await client.query(
      `select *
         from "sapCatalog"
        where "itemCode" = any($1::text[])
        order by "itemCode"`,
      [getAllCodes()]
    )
  ).rows;
  details.requestItems = (
    await client.query(
      `select ri.*, mr."requestNumber", mr.status as "requestStatus"
         from "requestItems" ri
         join "materialRequests" mr on mr.id = ri."requestId"
        where ri."sapItemCode" = any($1::text[])
        order by mr."requestNumber", ri.id`,
      [badCodes]
    )
  ).rows;
  details.purchaseRequestItems = (
    await client.query(
      `select pri.*, pr."requestNumber", pr.status as "purchaseRequestStatus"
         from "purchaseRequestItems" pri
         join "purchaseRequests" pr on pr.id = pri."purchaseRequestId"
        where pri."originalSapItemCode" = any($1::text[])
           or pri."currentSapItemCode" = any($1::text[])
        order by pr."requestNumber", pri.id`,
      [badCodes]
    )
  ).rows;
  details.purchaseOrders = (
    await client.query(
      `select po.*
         from "purchaseOrders" po
        where po.id in (
          select distinct "purchaseOrderId"
            from "purchaseOrderItems"
           where "originalSapItemCode" = any($1::text[])
              or "currentSapItemCode" = any($1::text[])
        )
        order by po."orderNumber"`,
      [badCodes]
    )
  ).rows;
  details.purchaseOrderItems = (
    await client.query(
      `select poi.*, po."orderNumber", po.status as "purchaseOrderStatus"
         from "purchaseOrderItems" poi
         join "purchaseOrders" po on po.id = poi."purchaseOrderId"
        where poi."originalSapItemCode" = any($1::text[])
           or poi."currentSapItemCode" = any($1::text[])
        order by po."orderNumber", poi.id`,
      [badCodes]
    )
  ).rows;
  details.receipts = (
    await client.query(
      `select r.*
         from receipts r
        where r.id in (
          select distinct "receiptId"
            from "receiptItems"
           where "sapItemCode" = any($1::text[])
        )
        order by r."receiptNumber"`,
      [badCodes]
    )
  ).rows;
  details.receiptItems = (
    await client.query(
      `select ri.*, r."receiptNumber", r.status as "receiptStatus"
         from "receiptItems" ri
         join receipts r on r.id = ri."receiptId"
        where ri."sapItemCode" = any($1::text[])
        order by r."receiptNumber", ri.id`,
      [badCodes]
    )
  ).rows;
  details.invoices = (
    await client.query(
      `select inv.*
         from invoices inv
        where inv.id in (
          select distinct "invoiceId"
            from "invoiceItems"
           where "originalSapItemCode" = any($1::text[])
              or "currentSapItemCode" = any($1::text[])
        )
        order by inv."invoiceDocumentNumber"`,
      [badCodes]
    )
  ).rows;
  details.invoiceItems = (
    await client.query(
      `select ii.*, inv."invoiceDocumentNumber", inv.status as "invoiceStatus"
         from "invoiceItems" ii
         join invoices inv on inv.id = ii."invoiceId"
        where ii."originalSapItemCode" = any($1::text[])
           or ii."currentSapItemCode" = any($1::text[])
        order by inv."invoiceDocumentNumber", ii.id`,
      [badCodes]
    )
  ).rows;
  details.inventoryItems = (
    await client.query(
      `select *
         from "inventoryItems"
        where "sapItemCode" = any($1::text[])
        order by "sapItemCode", id`,
      [badCodes]
    )
  ).rows;

  return details;
}

export async function collectSnapshot(
  client: Client | PoolClient
): Promise<Snapshot> {
  const badCodes = getBadCodes();
  const allCodes = getAllCodes();
  const catalogRows = await loadCatalogRows(client, allCodes);
  const tableColumnCounts = await loadReferenceCounts(client, allCodes);
  const details = await loadSnapshotDetails(client, badCodes);
  const affectedDocuments = await loadAffectedDocuments(client, badCodes);

  return {
    generatedAt: new Date().toISOString(),
    mappings: buildMappingStatuses(catalogRows, tableColumnCounts),
    tableColumnCounts,
    details,
    affectedDocuments,
  };
}

export function validatePreflight(snapshot: Snapshot): ValidationResult {
  const errors: string[] = [];

  for (const mapping of snapshot.mappings) {
    if (!mapping.badCatalog) {
      errors.push(`No existe el codigo malo esperado en sapCatalog: ${mapping.bad}`);
    }
    if (mapping.goodCatalog) {
      errors.push(
        `El codigo correcto ${mapping.good} ya existe en sapCatalog; no se puede renombrar ${mapping.bad}`
      );
    }
  }

  const duplicateBadCodes = SAP_CODE_MAPPINGS.filter(
    (mapping, index, list) =>
      list.findIndex(candidate => candidate.bad === mapping.bad) !== index
  );
  const duplicateGoodCodes = SAP_CODE_MAPPINGS.filter(
    (mapping, index, list) =>
      list.findIndex(candidate => candidate.good === mapping.good) !== index
  );
  if (duplicateBadCodes.length > 0) {
    errors.push("El mapeo contiene codigos malos duplicados");
  }
  if (duplicateGoodCodes.length > 0) {
    errors.push("El mapeo contiene codigos correctos duplicados");
  }

  return { errors };
}

async function updateReferenceColumn(
  client: Client | PoolClient,
  tableName: string,
  columnName: string,
  mappingsJson: string
) {
  const result = await client.query(
    `update ${quoteIdentifier(tableName)}
        set ${quoteIdentifier(columnName)} = ${getMappedCodeExpression(columnName)},
            "updatedAt" = now()
      where ${quoteIdentifier(columnName)} in (
        select mapping.bad
          from jsonb_to_recordset($1::jsonb) as mapping(bad text, good text)
      )`,
    [mappingsJson]
  );
  return result.rowCount ?? 0;
}

async function updateReferenceColumnWithoutUpdatedAt(
  client: Client | PoolClient,
  tableName: string,
  columnName: string,
  mappingsJson: string
) {
  const result = await client.query(
    `update ${quoteIdentifier(tableName)}
        set ${quoteIdentifier(columnName)} = ${getMappedCodeExpression(columnName)}
      where ${quoteIdentifier(columnName)} in (
        select mapping.bad
          from jsonb_to_recordset($1::jsonb) as mapping(bad text, good text)
      )`,
    [mappingsJson]
  );
  return result.rowCount ?? 0;
}

async function applyCorrections(
  client: Client | PoolClient,
  snapshot: Snapshot
): Promise<ApplyResult> {
  const mappingsJson = JSON.stringify(SAP_CODE_MAPPINGS);
  const updatedRows: Record<string, number> = {};
  const affectedDocuments = snapshot.affectedDocuments;

  await client.query("BEGIN");
  try {
    updatedRows["requestItems.sapItemCode"] = await updateReferenceColumn(
      client,
      "requestItems",
      "sapItemCode",
      mappingsJson
    );
    updatedRows["purchaseRequestItems.originalSapItemCode"] =
      await updateReferenceColumn(
        client,
        "purchaseRequestItems",
        "originalSapItemCode",
        mappingsJson
      );
    updatedRows["purchaseRequestItems.currentSapItemCode"] =
      await updateReferenceColumn(
        client,
        "purchaseRequestItems",
        "currentSapItemCode",
        mappingsJson
      );
    updatedRows["purchaseOrderItems.originalSapItemCode"] =
      await updateReferenceColumn(
        client,
        "purchaseOrderItems",
        "originalSapItemCode",
        mappingsJson
      );
    updatedRows["purchaseOrderItems.currentSapItemCode"] =
      await updateReferenceColumn(
        client,
        "purchaseOrderItems",
        "currentSapItemCode",
        mappingsJson
      );
    updatedRows["receiptItems.sapItemCode"] =
      await updateReferenceColumnWithoutUpdatedAt(
        client,
        "receiptItems",
        "sapItemCode",
        mappingsJson
      );
    updatedRows["invoiceItems.originalSapItemCode"] =
      await updateReferenceColumnWithoutUpdatedAt(
        client,
        "invoiceItems",
        "originalSapItemCode",
        mappingsJson
      );
    updatedRows["invoiceItems.currentSapItemCode"] =
      await updateReferenceColumnWithoutUpdatedAt(
        client,
        "invoiceItems",
        "currentSapItemCode",
        mappingsJson
      );
    updatedRows["inventoryItems.sapItemCode"] = await updateReferenceColumn(
      client,
      "inventoryItems",
      "sapItemCode",
      mappingsJson
    );
    updatedRows["sapCatalog.itemCode"] = await updateReferenceColumn(
      client,
      "sapCatalog",
      "itemCode",
      mappingsJson
    );

    let invalidatedPurchaseRequests = 0;
    if (affectedDocuments.purchaseRequestIds.length > 0) {
      const result = await client.query(
        `update "purchaseRequests"
            set "printedDocumentName" = null,
                "printedDocumentMimeType" = null,
                "printedDocumentContent" = null,
                "printedAt" = null,
                "updatedAt" = now()
          where id = any($1::int[])`,
        [affectedDocuments.purchaseRequestIds]
      );
      invalidatedPurchaseRequests = result.rowCount ?? 0;
    }

    let invalidatedPurchaseOrders = 0;
    if (affectedDocuments.purchaseOrderIds.length > 0) {
      const result = await client.query(
        `update "purchaseOrders"
            set "printedDocumentName" = null,
                "printedDocumentMimeType" = null,
                "printedDocumentContent" = null,
                "printedAt" = null,
                "updatedAt" = now()
          where id = any($1::int[])`,
        [affectedDocuments.purchaseOrderIds]
      );
      invalidatedPurchaseOrders = result.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return {
      updatedRows,
      invalidatedDocuments: {
        purchaseRequests: invalidatedPurchaseRequests,
        purchaseOrders: invalidatedPurchaseOrders,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function verifyCorrections(
  client: Client | PoolClient
): Promise<Verification> {
  const badCodes = getBadCodes();
  const goodCodes = getGoodCodes();
  const goodCatalogRows = await loadCatalogRows(client, goodCodes);
  const badCatalogRows = await loadCatalogRows(client, badCodes);
  const badReferences = await loadReferenceCounts(client, badCodes);
  const badReferencesRemaining = badReferences.reduce(
    (total, entry) =>
      total + entry.rows.reduce((rowTotal, row) => rowTotal + row.count, 0),
    0
  );

  return {
    goodCatalogCodesFound: goodCatalogRows.length,
    badCatalogCodesRemaining: badCatalogRows.length,
    badReferencesRemaining,
    badReferences,
  };
}

export async function createSapCodeCorrectionBackup(params: {
  databaseUrl: string;
  backupDir: string;
  pgDumpPath: string;
  timestamp?: Date;
}) {
  const resolvedBackupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });
  const backupPath = resolve(
    resolvedBackupDir,
    `buildreq-before-sap-code-correction-${formatTimestamp(params.timestamp ?? new Date())}.sql`
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
    throw new Error(
      `No se pudo crear el backup obligatorio con ${params.pgDumpPath}. ${details}`
    );
  }

  const backupStats = await stat(backupPath);
  if (backupStats.size <= 0) {
    throw new Error(`El backup obligatorio quedo vacio: ${backupPath}`);
  }

  return backupPath;
}

export async function writeSnapshot(params: {
  snapshot: Snapshot;
  backupDir: string;
  timestamp?: Date;
}) {
  const resolvedBackupDir = resolve(process.cwd(), params.backupDir);
  await mkdir(resolvedBackupDir, { recursive: true });
  const snapshotPath = resolve(
    resolvedBackupDir,
    `buildreq-before-sap-code-correction-${formatTimestamp(params.timestamp ?? new Date())}.snapshot.json`
  );

  await writeFile(
    snapshotPath,
    `${JSON.stringify(params.snapshot, null, 2)}\n`,
    "utf8"
  );

  const snapshotStats = await stat(snapshotPath);
  if (snapshotStats.size <= 0) {
    throw new Error(`El snapshot obligatorio quedo vacio: ${snapshotPath}`);
  }

  return snapshotPath;
}

function summarizeBadReferences(snapshot: Snapshot) {
  const badCodes = new Set(getBadCodes());
  return snapshot.tableColumnCounts.reduce(
    (total, entry) =>
      total +
      entry.rows
        .filter(row => badCodes.has(row.code))
        .reduce((rowTotal, row) => rowTotal + row.count, 0),
    0
  );
}

function buildReport(params: {
  mode: RunMode;
  before: Snapshot;
  validationErrors: string[];
  backupPath: string | null;
  snapshotPath: string | null;
  applyResult?: ApplyResult;
  verification?: Verification;
}): CorrectionReport {
  const badCatalogCodesFound = params.before.mappings.filter(
    mapping => mapping.badCatalog
  ).length;
  const goodCatalogConflicts = params.before.mappings.filter(
    mapping => mapping.goodCatalog
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    mode: params.mode,
    backupPath: params.backupPath,
    snapshotPath: params.snapshotPath,
    summary: {
      mappings: SAP_CODE_MAPPINGS.length,
      badCatalogCodesFound,
      goodCatalogConflicts,
      badReferences: summarizeBadReferences(params.before),
      purchaseRequestsToInvalidate:
        params.before.affectedDocuments.purchaseRequestIds.length,
      purchaseOrdersToInvalidate:
        params.before.affectedDocuments.purchaseOrderIds.length,
      validationErrors: params.validationErrors.length,
    },
    validationErrors: params.validationErrors,
    before: params.before,
    applyResult: params.applyResult,
    verification: params.verification,
  };
}

async function writeJsonReport(reportPath: string, report: CorrectionReport) {
  const resolvedPath = resolve(process.cwd(), reportPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function getDefaultReportPath(mode: RunMode) {
  return `${DEFAULT_REPORT_DIR}/sap-code-correction-${mode}-${formatTimestamp(new Date())}.json`;
}

function printHelp() {
  console.log(`
Uso:
  pnpm exec tsx scripts/correct-sap-item-codes.ts --dry-run
  pnpm exec tsx scripts/correct-sap-item-codes.ts --apply

Opciones:
  --dry-run                Valida y genera reporte sin aplicar cambios.
  --apply                  Crea backup, snapshot y aplica la correccion.
  --report <json>          Ruta del reporte JSON.
  --backup-dir <dir>       Carpeta para backups. Default: backups.
  --pg-dump-path <path>    Ruta exacta de pg_dump si no esta en PATH.
`);
}

function printSummary(report: CorrectionReport, reportPath: string) {
  console.log(`Modo: ${report.mode}`);
  console.log(`Mapeos: ${report.summary.mappings}`);
  console.log(`Codigos malos encontrados: ${report.summary.badCatalogCodesFound}`);
  console.log(`Conflictos con codigos correctos: ${report.summary.goodCatalogConflicts}`);
  console.log(`Referencias malas actuales: ${report.summary.badReferences}`);
  console.log(
    `SC a invalidar: ${report.summary.purchaseRequestsToInvalidate}`
  );
  console.log(`OC a invalidar: ${report.summary.purchaseOrdersToInvalidate}`);
  console.log(`Errores de validacion: ${report.summary.validationErrors}`);
  if (report.applyResult) {
    console.log(
      `SC invalidadas: ${report.applyResult.invalidatedDocuments.purchaseRequests}`
    );
    console.log(
      `OC invalidadas: ${report.applyResult.invalidatedDocuments.purchaseOrders}`
    );
  }
  if (report.verification) {
    console.log(`Catalogo correcto encontrado: ${report.verification.goodCatalogCodesFound}`);
    console.log(`Codigos malos restantes en catalogo: ${report.verification.badCatalogCodesRemaining}`);
    console.log(`Referencias malas restantes: ${report.verification.badReferencesRemaining}`);
  }
  if (report.backupPath) console.log(`Backup: ${report.backupPath}`);
  if (report.snapshotPath) console.log(`Snapshot: ${report.snapshotPath}`);
  console.log(`Reporte: ${reportPath}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseSapCodeCorrectionArgs(args);

  if (options.help) {
    printHelp();
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurada");
  }

  const reportPath = options.reportPath ?? getDefaultReportPath(options.mode);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    let before = await collectSnapshot(client);
    let validation = validatePreflight(before);
    let backupPath: string | null = null;
    let snapshotPath: string | null = null;
    let applyResult: ApplyResult | undefined;
    let verification: Verification | undefined;

    if (validation.errors.length > 0) {
      const report = buildReport({
        mode: options.mode,
        before,
        validationErrors: validation.errors,
        backupPath,
        snapshotPath,
      });
      const resolvedReportPath = await writeJsonReport(reportPath, report);
      printSummary(report, resolvedReportPath);
      throw new Error("La validacion fallo; no se aplicaron cambios");
    }

    if (options.mode === "apply") {
      const timestamp = new Date();
      console.log("Creando backup obligatorio con pg_dump...");
      backupPath = await createSapCodeCorrectionBackup({
        databaseUrl: process.env.DATABASE_URL,
        backupDir: options.backupDir,
        pgDumpPath: options.pgDumpPath,
        timestamp,
      });
      console.log(`Backup creado: ${backupPath}`);
      console.log("Creando snapshot JSON...");
      snapshotPath = await writeSnapshot({
        snapshot: before,
        backupDir: options.backupDir,
        timestamp,
      });
      console.log(`Snapshot creado: ${snapshotPath}`);

      before = await collectSnapshot(client);
      validation = validatePreflight(before);
      if (validation.errors.length > 0) {
        throw new Error(
          "La validacion posterior al backup fallo; no se aplicaron cambios"
        );
      }

      applyResult = await applyCorrections(client, before);
      verification = await verifyCorrections(client);
      if (
        verification.goodCatalogCodesFound !== SAP_CODE_MAPPINGS.length ||
        verification.badCatalogCodesRemaining > 0 ||
        verification.badReferencesRemaining > 0
      ) {
        throw new Error("La verificacion posterior encontro codigos malos");
      }
    }

    const report = buildReport({
      mode: options.mode,
      before,
      validationErrors: validation.errors,
      backupPath,
      snapshotPath,
      applyResult,
      verification,
    });
    const resolvedReportPath = await writeJsonReport(reportPath, report);
    printSummary(report, resolvedReportPath);
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
