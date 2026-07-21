import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  collectResetOperationalMovementsSnapshot,
  getResetOperationalMovementsCleanupStatements,
  type ResetOperationalMovementsCounts,
  type ResetOperationalMovementsExecutor,
  type ResetOperationalMovementsStorageFailure,
  type ResetOperationalMovementsStorageResult,
} from "./resetOperationalMovements";

export const PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION =
  "PRUNE_CATALOG_TO_HIDALGO_461";

export const HIDALGO_KEEP_CODE_COUNT = 461;

export type PruneCatalogCounts = {
  total: number;
  keep: number;
  nonKeep: number;
  keepActive: number;
  keepInactive: number;
  missingKeepCodes: string[];
};

export type PruneInventoryCounts = {
  total: number;
  keep: number;
  nonKeep: number;
};

export type PruneCatalogSnapshot = {
  operationalCounts: ResetOperationalMovementsCounts;
  attachmentFileKeys: string[];
  catalog: PruneCatalogCounts;
  inventory: PruneInventoryCounts;
};

export type PruneCatalogResult = {
  dryRun: boolean;
  keepCodes: number;
  before: PruneCatalogSnapshot;
  after?: PruneCatalogSnapshot;
  verificationProblems: string[];
  storage: ResetOperationalMovementsStorageResult;
};

export type PruneCatalogOptions = {
  dryRun?: boolean;
  deleteStorage?: boolean;
  storageDelete?: (fileKey: string) => Promise<unknown>;
  storageDeleteRetries?: number;
  failureReportPath?: string;
  logger?: Pick<Console, "log" | "warn" | "error">;
};

const OPERATIONAL_CLEANUP_STATEMENTS =
  getResetOperationalMovementsCleanupStatements().filter(
    statement => !statement.startsWith('UPDATE "inventoryItems"')
  );

const OPERATIONAL_ZERO_COUNT_KEYS = [
  "materialRequests",
  "requestItems",
  "supplyFlowRecords",
  "purchaseRequests",
  "purchaseRequestItems",
  "purchaseOrders",
  "procurementApprovalHistory",
  "purchaseOrderAuditLogs",
  "purchaseOrderItems",
  "transferRequests",
  "transferRequestItems",
  "transfers",
  "remissionGuides",
  "receipts",
  "receiptItems",
  "receiptOtherCharges",
  "invoices",
  "treasuryPaymentBatches",
  "treasuryPaymentItems",
  "treasuryPaymentEvents",
  "invoiceItems",
  "invoiceOtherCharges",
  "invoiceRetentions",
  "supplierFiscalDocumentRangeInvoiceRefs",
  "warehouseExits",
  "warehouseExitItems",
  "openingBalances",
  "openingBalanceItems",
  "reverseLogistics",
  "reverseLogisticsItems",
  "sapSyncLog",
  "operativeNotifications",
  "operativeAttachments",
] as const;

function quoteSqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function keepValuesSql(keepCodes: string[]) {
  return keepCodes.map(code => `(${quoteSqlLiteral(code)})`).join(", ");
}

function readCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => String(item));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "{}") return [];
    return trimmed
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map(item => item.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }

  return [];
}

export function validateHidalgoKeepCodes(keepCodes: string[]) {
  const normalized = keepCodes.map(code => code.trim()).filter(Boolean);
  const unique = Array.from(new Set(normalized));

  if (normalized.length !== HIDALGO_KEEP_CODE_COUNT) {
    throw new Error(
      `La whitelist debe tener ${HIDALGO_KEEP_CODE_COUNT} codigos; recibio ${normalized.length}`
    );
  }

  if (unique.length !== normalized.length) {
    throw new Error("La whitelist contiene codigos duplicados");
  }

  return normalized;
}

async function collectCatalogCounts(
  executor: ResetOperationalMovementsExecutor,
  keepCodes: string[]
): Promise<PruneCatalogCounts> {
  const valuesSql = keepValuesSql(keepCodes);
  const counts = await executor.run(
    `WITH keep("itemCode") AS (VALUES ${valuesSql})
     SELECT count(*)::int AS "total",
            count(*) FILTER (
              WHERE catalog."itemCode" IN (SELECT "itemCode" FROM keep)
            )::int AS "keep",
            count(*) FILTER (
              WHERE catalog."itemCode" NOT IN (SELECT "itemCode" FROM keep)
            )::int AS "nonKeep",
            count(*) FILTER (
              WHERE catalog."itemCode" IN (SELECT "itemCode" FROM keep)
                AND catalog."isActive" = true
            )::int AS "keepActive",
            count(*) FILTER (
              WHERE catalog."itemCode" IN (SELECT "itemCode" FROM keep)
                AND catalog."isActive" = false
            )::int AS "keepInactive"
       FROM "sapCatalog" catalog`
  );
  const missing = await executor.run(
    `WITH keep("itemCode") AS (VALUES ${valuesSql})
     SELECT COALESCE(
              array_agg(keep."itemCode" ORDER BY keep."itemCode")
                FILTER (WHERE catalog."itemCode" IS NULL),
              '{}'
            ) AS "missingKeepCodes"
       FROM keep
       LEFT JOIN "sapCatalog" catalog
         ON catalog."itemCode" = keep."itemCode"`
  );
  const row = counts.rows?.[0] ?? {};
  const missingRow = missing.rows?.[0] ?? {};

  return {
    total: readCount(row.total),
    keep: readCount(row.keep),
    nonKeep: readCount(row.nonKeep),
    keepActive: readCount(row.keepActive),
    keepInactive: readCount(row.keepInactive),
    missingKeepCodes: readStringArray(missingRow.missingKeepCodes),
  };
}

async function collectInventoryCounts(
  executor: ResetOperationalMovementsExecutor,
  keepCodes: string[]
): Promise<PruneInventoryCounts> {
  const valuesSql = keepValuesSql(keepCodes);
  const result = await executor.run(
    `WITH keep("itemCode") AS (VALUES ${valuesSql})
     SELECT count(*)::int AS "total",
            count(*) FILTER (
              WHERE inventory."sapItemCode" IN (SELECT "itemCode" FROM keep)
            )::int AS "keep",
            count(*) FILTER (
              WHERE inventory."sapItemCode" IS NULL
                 OR inventory."sapItemCode" NOT IN (SELECT "itemCode" FROM keep)
            )::int AS "nonKeep"
       FROM "inventoryItems" inventory`
  );
  const row = result.rows?.[0] ?? {};

  return {
    total: readCount(row.total),
    keep: readCount(row.keep),
    nonKeep: readCount(row.nonKeep),
  };
}

export async function collectPruneCatalogSnapshot(
  executor: ResetOperationalMovementsExecutor,
  keepCodes: string[]
): Promise<PruneCatalogSnapshot> {
  const operational = await collectResetOperationalMovementsSnapshot(executor);
  const catalog = await collectCatalogCounts(executor, keepCodes);
  const inventory = await collectInventoryCounts(executor, keepCodes);

  return {
    operationalCounts: operational.counts,
    attachmentFileKeys: operational.attachmentFileKeys,
    catalog,
    inventory,
  };
}

export function validatePrunePreflight(snapshot: PruneCatalogSnapshot) {
  const problems: string[] = [];

  if (snapshot.catalog.missingKeepCodes.length > 0) {
    problems.push(
      `Faltan ${snapshot.catalog.missingKeepCodes.length} codigos de la whitelist en sapCatalog`
    );
  }

  if (snapshot.catalog.keep !== HIDALGO_KEEP_CODE_COUNT) {
    problems.push(
      `sapCatalog contiene ${snapshot.catalog.keep} codigos conservados; se esperaban ${HIDALGO_KEEP_CODE_COUNT}`
    );
  }

  return problems;
}

export function validatePruneVerification(snapshot: PruneCatalogSnapshot) {
  const problems: string[] = [];

  if (snapshot.catalog.total !== HIDALGO_KEEP_CODE_COUNT) {
    problems.push(
      `sapCatalog.total=${snapshot.catalog.total}; se esperaban ${HIDALGO_KEEP_CODE_COUNT}`
    );
  }
  if (snapshot.catalog.nonKeep !== 0) {
    problems.push(
      `sapCatalog.nonKeep=${snapshot.catalog.nonKeep}; se esperaba 0`
    );
  }
  if (snapshot.catalog.keep !== HIDALGO_KEEP_CODE_COUNT) {
    problems.push(
      `sapCatalog.keep=${snapshot.catalog.keep}; se esperaban ${HIDALGO_KEEP_CODE_COUNT}`
    );
  }
  if (snapshot.catalog.keepInactive !== 0) {
    problems.push(
      `Hay ${snapshot.catalog.keepInactive} codigos Hidalgo inactivos`
    );
  }
  if (snapshot.catalog.missingKeepCodes.length > 0) {
    problems.push(
      `Faltan ${snapshot.catalog.missingKeepCodes.length} codigos Hidalgo`
    );
  }
  if (snapshot.inventory.nonKeep !== 0) {
    problems.push(
      `inventoryItems.nonKeep=${snapshot.inventory.nonKeep}; se esperaba 0`
    );
  }

  for (const key of OPERATIONAL_ZERO_COUNT_KEYS) {
    const value = snapshot.operationalCounts[key] ?? 0;
    if (value !== 0) {
      problems.push(`${key}=${value}; se esperaba 0`);
    }
  }

  return problems;
}

function deleteInventoryStatement(keepCodes: string[]) {
  const valuesSql = keepValuesSql(keepCodes);
  return `WITH keep("itemCode") AS (VALUES ${valuesSql})
DELETE FROM "inventoryItems" inventory
WHERE inventory."sapItemCode" IS NULL
   OR inventory."sapItemCode" NOT IN (SELECT "itemCode" FROM keep)`;
}

function deleteCatalogStatement(keepCodes: string[]) {
  const valuesSql = keepValuesSql(keepCodes);
  return `WITH keep("itemCode") AS (VALUES ${valuesSql})
DELETE FROM "sapCatalog" catalog
WHERE catalog."itemCode" NOT IN (SELECT "itemCode" FROM keep)`;
}

export function getPruneCatalogCleanupStatements(keepCodes: string[]) {
  const normalized = validateHidalgoKeepCodes(keepCodes);
  return [
    ...OPERATIONAL_CLEANUP_STATEMENTS,
    deleteInventoryStatement(normalized),
    deleteCatalogStatement(normalized),
  ];
}

export async function executePruneCatalogToHidalgoAssets(
  executor: ResetOperationalMovementsExecutor,
  keepCodesInput: string[],
  options: PruneCatalogOptions = {}
): Promise<PruneCatalogResult> {
  const keepCodes = validateHidalgoKeepCodes(keepCodesInput);
  const dryRun = options.dryRun !== false;
  const deleteStorage = options.deleteStorage !== false;
  const before = await collectPruneCatalogSnapshot(executor, keepCodes);
  const preflightProblems = validatePrunePreflight(before);

  if (preflightProblems.length > 0) {
    throw new Error(
      `No se puede ejecutar la limpieza: ${preflightProblems.join("; ")}`
    );
  }

  if (dryRun) {
    return {
      dryRun: true,
      keepCodes: keepCodes.length,
      before,
      verificationProblems: [],
      storage: {
        attempted: 0,
        deleted: 0,
        failed: [],
      },
    };
  }

  if (
    deleteStorage &&
    !options.storageDelete &&
    before.attachmentFileKeys.length > 0
  ) {
    throw new Error(
      "storageDelete is required when deleting operational attachment records"
    );
  }

  const transactionResult = await executor.transaction(async tx => {
    const transactionBefore = await collectPruneCatalogSnapshot(tx, keepCodes);
    const transactionPreflight = validatePrunePreflight(transactionBefore);
    if (transactionPreflight.length > 0) {
      throw new Error(
        `No se puede ejecutar la limpieza: ${transactionPreflight.join("; ")}`
      );
    }

    for (const statement of getPruneCatalogCleanupStatements(keepCodes)) {
      await tx.run(statement);
    }

    const after = await collectPruneCatalogSnapshot(tx, keepCodes);
    const verificationProblems = validatePruneVerification(after);
    if (verificationProblems.length > 0) {
      throw new Error(
        `La verificacion post-limpieza fallo: ${verificationProblems.join("; ")}`
      );
    }

    return { after, verificationProblems };
  });

  const storage = deleteStorage
    ? await deleteStorageFiles(before.attachmentFileKeys, options)
    : {
        attempted: 0,
        deleted: 0,
        failed: [] as ResetOperationalMovementsStorageFailure[],
      };

  if (storage.failed.length > 0 && options.failureReportPath) {
    await mkdir(dirname(options.failureReportPath), { recursive: true });
    await writeFile(
      options.failureReportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          failed: storage.failed,
        },
        null,
        2
      ),
      "utf8"
    );
    storage.failureReportPath = options.failureReportPath;
  }

  return {
    dryRun: false,
    keepCodes: keepCodes.length,
    before,
    after: transactionResult.after,
    verificationProblems: transactionResult.verificationProblems,
    storage,
  };
}

async function deleteStorageFiles(
  fileKeys: string[],
  options: PruneCatalogOptions
): Promise<ResetOperationalMovementsStorageResult> {
  const failed: ResetOperationalMovementsStorageFailure[] = [];
  let deleted = 0;
  const retries = Math.max(1, options.storageDeleteRetries ?? 3);

  for (const fileKey of fileKeys) {
    let lastError = "";

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await options.storageDelete?.(fileKey);
        deleted += 1;
        lastError = "";
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < retries) {
          options.logger?.warn(
            `Retrying storage delete for ${fileKey} (${attempt}/${retries})`
          );
        }
      }
    }

    if (lastError) {
      failed.push({ fileKey, error: lastError });
    }
  }

  return {
    attempted: fileKeys.length,
    deleted,
    failed,
  };
}
