import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sql, type SQL } from "drizzle-orm";

export const RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION =
  "RESET_OPERATIONAL_MOVEMENTS";

export const RESET_OPERATIONAL_ATTACHMENT_ENTITY_TYPES = [
  "material_request",
  "supply_flow",
  "reverse_logistic",
  "purchase_request",
  "purchase_order",
  "transfer_request",
  "transfer",
  "receipt",
  "invoice",
] as const;

const OPERATIONAL_ATTACHMENT_ENTITY_TYPES_SQL =
  RESET_OPERATIONAL_ATTACHMENT_ENTITY_TYPES.map(value => `'${value}'`).join(", ");

export type ResetOperationalMovementsQueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

export type ResetOperationalMovementsExecutor = {
  run(query: string): Promise<ResetOperationalMovementsQueryResult>;
  transaction<T>(
    callback: (tx: ResetOperationalMovementsExecutor) => Promise<T>
  ): Promise<T>;
};

export type ResetOperationalMovementsCounts = Record<string, number>;

export type ResetOperationalMovementsSnapshot = {
  counts: ResetOperationalMovementsCounts;
  attachmentFileKeys: string[];
};

export type ResetOperationalMovementsStorageFailure = {
  fileKey: string;
  error: string;
};

export type ResetOperationalMovementsStorageResult = {
  attempted: number;
  deleted: number;
  failed: ResetOperationalMovementsStorageFailure[];
  failureReportPath?: string;
};

export type ResetOperationalMovementsResult = {
  dryRun: boolean;
  counts: ResetOperationalMovementsCounts;
  attachmentFileKeys: string[];
  storage: ResetOperationalMovementsStorageResult;
};

export type ResetOperationalMovementsOptions = {
  dryRun?: boolean;
  deleteStorage?: boolean;
  storageDelete?: (fileKey: string) => Promise<unknown>;
  storageDeleteRetries?: number;
  failureReportPath?: string;
  logger?: Pick<Console, "log" | "warn" | "error">;
};

const COUNT_QUERIES: Array<{ key: string; query: string }> = [
  { key: "usersPreserved", query: `SELECT count(*)::int AS "count" FROM "users"` },
  {
    key: "invitationsPreserved",
    query: `SELECT count(*)::int AS "count" FROM "invitations"`,
  },
  {
    key: "projectsPreserved",
    query: `SELECT count(*)::int AS "count" FROM "projects"`,
  },
  {
    key: "warehousesPreserved",
    query: `SELECT count(*)::int AS "count" FROM "warehouses"`,
  },
  {
    key: "suppliersPreserved",
    query: `SELECT count(*)::int AS "count" FROM "suppliers"`,
  },
  {
    key: "sapCatalogPreserved",
    query: `SELECT count(*)::int AS "count" FROM "sapCatalog"`,
  },
  {
    key: "inventoryItemsPreserved",
    query: `SELECT count(*)::int AS "count" FROM "inventoryItems"`,
  },
  {
    key: "inventoryItemsStockToZero",
    query: `SELECT count(*)::int AS "count" FROM "inventoryItems" WHERE "currentStock" <> '0.00'`,
  },
  {
    key: "materialRequests",
    query: `SELECT count(*)::int AS "count" FROM "materialRequests"`,
  },
  { key: "requestItems", query: `SELECT count(*)::int AS "count" FROM "requestItems"` },
  {
    key: "supplyFlowRecords",
    query: `SELECT count(*)::int AS "count" FROM "supplyFlowRecords"`,
  },
  {
    key: "purchaseRequests",
    query: `SELECT count(*)::int AS "count" FROM "purchaseRequests"`,
  },
  {
    key: "purchaseRequestItems",
    query: `SELECT count(*)::int AS "count" FROM "purchaseRequestItems"`,
  },
  {
    key: "purchaseOrders",
    query: `SELECT count(*)::int AS "count" FROM "purchaseOrders"`,
  },
  {
    key: "purchaseOrderAuditLogs",
    query: `SELECT count(*)::int AS "count" FROM "purchaseOrderAuditLogs"`,
  },
  {
    key: "purchaseOrderItems",
    query: `SELECT count(*)::int AS "count" FROM "purchaseOrderItems"`,
  },
  {
    key: "transferRequests",
    query: `SELECT count(*)::int AS "count" FROM "transferRequests"`,
  },
  {
    key: "transferRequestItems",
    query: `SELECT count(*)::int AS "count" FROM "transferRequestItems"`,
  },
  { key: "transfers", query: `SELECT count(*)::int AS "count" FROM "transfers"` },
  {
    key: "remissionGuides",
    query: `SELECT count(*)::int AS "count" FROM "remissionGuides"`,
  },
  { key: "receipts", query: `SELECT count(*)::int AS "count" FROM "receipts"` },
  { key: "receiptItems", query: `SELECT count(*)::int AS "count" FROM "receiptItems"` },
  {
    key: "receiptOtherCharges",
    query: `SELECT count(*)::int AS "count" FROM "receiptOtherCharges"`,
  },
  { key: "invoices", query: `SELECT count(*)::int AS "count" FROM "invoices"` },
  { key: "invoiceItems", query: `SELECT count(*)::int AS "count" FROM "invoiceItems"` },
  {
    key: "invoiceOtherCharges",
    query: `SELECT count(*)::int AS "count" FROM "invoiceOtherCharges"`,
  },
  {
    key: "invoiceRetentions",
    query: `SELECT count(*)::int AS "count" FROM "invoiceRetentions"`,
  },
  {
    key: "supplierFiscalDocumentRangeInvoiceRefs",
    query: `SELECT count(*)::int AS "count" FROM "supplierFiscalDocumentRanges" WHERE "sourceInvoiceId" IS NOT NULL`,
  },
  {
    key: "warehouseExits",
    query: `SELECT count(*)::int AS "count" FROM "warehouseExits"`,
  },
  {
    key: "warehouseExitItems",
    query: `SELECT count(*)::int AS "count" FROM "warehouseExitItems"`,
  },
  {
    key: "openingBalances",
    query: `SELECT count(*)::int AS "count" FROM "openingBalances"`,
  },
  {
    key: "openingBalanceItems",
    query: `SELECT count(*)::int AS "count" FROM "openingBalanceItems"`,
  },
  {
    key: "reverseLogistics",
    query: `SELECT count(*)::int AS "count" FROM "reverseLogistics"`,
  },
  {
    key: "reverseLogisticsItems",
    query: `SELECT count(*)::int AS "count" FROM "reverseLogisticsItems"`,
  },
  { key: "sapSyncLog", query: `SELECT count(*)::int AS "count" FROM "sapSyncLog"` },
  {
    key: "operativeNotifications",
    query: `SELECT count(*)::int AS "count" FROM "notifications" WHERE "type" <> 'sistema'`,
  },
  {
    key: "operativeAttachments",
    query: `SELECT count(*)::int AS "count" FROM "attachments" WHERE "entityType" IN (${OPERATIONAL_ATTACHMENT_ENTITY_TYPES_SQL})`,
  },
];

const ATTACHMENT_FILE_KEYS_QUERY = `SELECT "fileKey" AS "fileKey" FROM "attachments" WHERE "entityType" IN (${OPERATIONAL_ATTACHMENT_ENTITY_TYPES_SQL})`;

const CLEANUP_STATEMENTS = [
  `DELETE FROM "attachments" WHERE "entityType" IN (${OPERATIONAL_ATTACHMENT_ENTITY_TYPES_SQL})`,
  `DELETE FROM "notifications" WHERE "type" <> 'sistema'`,
  `DELETE FROM "sapSyncLog"`,
  `DELETE FROM "invoiceRetentions"`,
  `DELETE FROM "invoiceOtherCharges"`,
  `UPDATE "supplierFiscalDocumentRanges" SET "sourceInvoiceId" = NULL WHERE "sourceInvoiceId" IS NOT NULL`,
  `DELETE FROM "invoiceItems"`,
  `DELETE FROM "invoices"`,
  `DELETE FROM "receiptOtherCharges"`,
  `DELETE FROM "receiptItems"`,
  `DELETE FROM "receipts"`,
  `DELETE FROM "reverseLogisticsItems"`,
  `DELETE FROM "reverseLogistics"`,
  `DELETE FROM "warehouseExitItems"`,
  `DELETE FROM "warehouseExits"`,
  `DELETE FROM "openingBalanceItems"`,
  `DELETE FROM "openingBalances"`,
  `DELETE FROM "remissionGuides"`,
  `DELETE FROM "transfers"`,
  `DELETE FROM "transferRequestItems"`,
  `DELETE FROM "transferRequests"`,
  `DELETE FROM "purchaseOrderAuditLogs"`,
  `DELETE FROM "purchaseOrderItems"`,
  `DELETE FROM "purchaseOrders"`,
  `DELETE FROM "purchaseRequestItems"`,
  `DELETE FROM "purchaseRequests"`,
  `DELETE FROM "supplyFlowRecords"`,
  `DELETE FROM "requestItems"`,
  `DELETE FROM "materialRequests"`,
  `UPDATE "inventoryItems" SET "currentStock" = '0.00', "updatedAt" = now() WHERE "currentStock" <> '0.00'`,
] as const;

export function createDrizzleResetOperationalMovementsExecutor(client: {
  execute: (query: SQL) => Promise<unknown>;
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
}): ResetOperationalMovementsExecutor {
  return {
    async run(query: string) {
      return normalizeQueryResult(await client.execute(sql.raw(query)));
    },
    async transaction(callback) {
      return client.transaction(tx =>
        callback(createDrizzleResetOperationalMovementsExecutor(tx))
      );
    },
  };
}

export async function collectResetOperationalMovementsSnapshot(
  executor: ResetOperationalMovementsExecutor
): Promise<ResetOperationalMovementsSnapshot> {
  const counts: ResetOperationalMovementsCounts = {};

  for (const entry of COUNT_QUERIES) {
    const result = await executor.run(entry.query);
    counts[entry.key] = readCount(result);
  }

  const fileKeyRows = (await executor.run(ATTACHMENT_FILE_KEYS_QUERY)).rows ?? [];
  const attachmentFileKeys = Array.from(
    new Set(
      fileKeyRows
        .map(row => String(row.fileKey ?? "").trim())
        .filter(Boolean)
    )
  );

  return { counts, attachmentFileKeys };
}

export async function executeResetOperationalMovements(
  executor: ResetOperationalMovementsExecutor,
  options: ResetOperationalMovementsOptions = {}
): Promise<ResetOperationalMovementsResult> {
  const dryRun = options.dryRun !== false;
  const deleteStorage = options.deleteStorage !== false;

  if (dryRun) {
    const snapshot = await collectResetOperationalMovementsSnapshot(executor);
    return {
      dryRun: true,
      counts: snapshot.counts,
      attachmentFileKeys: snapshot.attachmentFileKeys,
      storage: {
        attempted: 0,
        deleted: 0,
        failed: [],
      },
    };
  }

  if (deleteStorage && !options.storageDelete) {
    const preflight = await collectResetOperationalMovementsSnapshot(executor);
    if (preflight.attachmentFileKeys.length > 0) {
      throw new Error(
        "storageDelete is required when deleting operational attachment records"
      );
    }
  }

  const snapshot = await executor.transaction(async tx => {
    const transactionSnapshot = await collectResetOperationalMovementsSnapshot(tx);

    for (const statement of CLEANUP_STATEMENTS) {
      await tx.run(statement);
    }

    return transactionSnapshot;
  });

  const storage = deleteStorage
    ? await deleteStorageFiles(snapshot.attachmentFileKeys, options)
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
    counts: snapshot.counts,
    attachmentFileKeys: snapshot.attachmentFileKeys,
    storage,
  };
}

export function getResetOperationalMovementsCleanupStatements() {
  return [...CLEANUP_STATEMENTS];
}

async function deleteStorageFiles(
  fileKeys: string[],
  options: ResetOperationalMovementsOptions
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

function normalizeQueryResult(
  result: unknown
): ResetOperationalMovementsQueryResult {
  if (Array.isArray(result)) {
    return { rows: result as Array<Record<string, unknown>>, rowCount: result.length };
  }

  if (result && typeof result === "object") {
    const maybeResult = result as {
      rows?: unknown;
      rowCount?: unknown;
    };
    return {
      rows: Array.isArray(maybeResult.rows)
        ? (maybeResult.rows as Array<Record<string, unknown>>)
        : [],
      rowCount:
        typeof maybeResult.rowCount === "number"
          ? maybeResult.rowCount
          : undefined,
    };
  }

  return { rows: [], rowCount: 0 };
}

function readCount(result: ResetOperationalMovementsQueryResult) {
  const raw = result.rows?.[0]?.count ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
