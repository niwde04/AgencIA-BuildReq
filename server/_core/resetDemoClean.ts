import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sql, type SQL } from "drizzle-orm";

export const RESET_DEMO_CLEAN_CONFIRMATION = "RESET_DEMO_CLEAN";

export const RESET_DEMO_ATTACHMENT_ENTITY_TYPES = [
  "material_request",
  "supply_flow",
  "reverse_logistic",
  "purchase_request",
  "purchase_order",
  "transfer_request",
  "transfer",
  "receipt",
  "invoice",
  "treasury_payment_batch",
  "supplier",
] as const;

const OPERATIVE_ATTACHMENT_ENTITY_TYPES_SQL =
  RESET_DEMO_ATTACHMENT_ENTITY_TYPES.map(value => `'${value}'`).join(", ");

export type ResetDemoCleanQueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

export type ResetDemoCleanExecutor = {
  run(query: string): Promise<ResetDemoCleanQueryResult>;
  transaction<T>(
    callback: (tx: ResetDemoCleanExecutor) => Promise<T>
  ): Promise<T>;
};

export type ResetDemoCleanCounts = Record<string, number>;

export type ResetDemoCleanSnapshot = {
  counts: ResetDemoCleanCounts;
  attachmentFileKeys: string[];
};

export type ResetDemoCleanStorageFailure = {
  fileKey: string;
  error: string;
};

export type ResetDemoCleanResult = {
  dryRun: boolean;
  counts: ResetDemoCleanCounts;
  attachmentFileKeys: string[];
  storage: ResetDemoCleanStorageResult;
};

export type ResetDemoCleanStorageResult = {
  attempted: number;
  deleted: number;
  failed: ResetDemoCleanStorageFailure[];
  failureReportPath?: string;
};

export type ResetDemoCleanOptions = {
  dryRun?: boolean;
  deleteStorage?: boolean;
  storageDelete?: (fileKey: string) => Promise<unknown>;
  storageDeleteRetries?: number;
  failureReportPath?: string;
  logger?: Pick<Console, "log" | "warn" | "error">;
};

const COUNT_QUERIES: Array<{ key: string; query: string }> = [
  {
    key: "usersPreserved",
    query: `SELECT count(*)::int AS "count" FROM "users"`,
  },
  {
    key: "invitationsPreserved",
    query: `SELECT count(*)::int AS "count" FROM "invitations"`,
  },
  {
    key: "materialRequests",
    query: `SELECT count(*)::int AS "count" FROM "materialRequests"`,
  },
  {
    key: "requestItems",
    query: `SELECT count(*)::int AS "count" FROM "requestItems"`,
  },
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
    key: "procurementApprovalHistory",
    query: `SELECT count(*)::int AS "count" FROM "procurementApprovalHistory"`,
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
  {
    key: "transfers",
    query: `SELECT count(*)::int AS "count" FROM "transfers"`,
  },
  {
    key: "remissionGuides",
    query: `SELECT count(*)::int AS "count" FROM "remissionGuides"`,
  },
  { key: "receipts", query: `SELECT count(*)::int AS "count" FROM "receipts"` },
  {
    key: "receiptItems",
    query: `SELECT count(*)::int AS "count" FROM "receiptItems"`,
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
  {
    key: "sapSyncLog",
    query: `SELECT count(*)::int AS "count" FROM "sapSyncLog"`,
  },
  {
    key: "treasuryPaymentBatches",
    query: `SELECT count(*)::int AS "count" FROM "treasuryPaymentBatches"`,
  },
  {
    key: "treasuryPaymentItems",
    query: `SELECT count(*)::int AS "count" FROM "treasuryPaymentItems"`,
  },
  {
    key: "treasuryPaymentEvents",
    query: `SELECT count(*)::int AS "count" FROM "treasuryPaymentEvents"`,
  },
  {
    key: "operativeNotifications",
    query: `SELECT count(*)::int AS "count" FROM "notifications" WHERE "type" <> 'sistema'`,
  },
  {
    key: "operativeAttachments",
    query: `SELECT count(*)::int AS "count" FROM "attachments" WHERE "entityType" IN (${OPERATIVE_ATTACHMENT_ENTITY_TYPES_SQL})`,
  },
  {
    key: "demoProjectsKept",
    query: `SELECT count(*)::int AS "count" FROM "projects" WHERE "demoBatchKey" IS NOT NULL`,
  },
  {
    key: "manualProjectsDeleted",
    query: `SELECT count(*)::int AS "count" FROM "projects" WHERE "demoBatchKey" IS NULL`,
  },
  {
    key: "projectWarehouseAssignments",
    query: `SELECT count(*)::int AS "count" FROM "projectWarehouseAssignments"`,
  },
  {
    key: "demoSapCatalogKept",
    query: `SELECT count(*)::int AS "count" FROM "sapCatalog" WHERE "demoBatchKey" IS NOT NULL`,
  },
  {
    key: "manualSapCatalogDeleted",
    query: `SELECT count(*)::int AS "count" FROM "sapCatalog" WHERE "demoBatchKey" IS NULL`,
  },
  {
    key: "demoInventoryKept",
    query: `SELECT count(*)::int AS "count" FROM "inventoryItems" WHERE "demoBatchKey" IS NOT NULL`,
  },
  {
    key: "manualInventoryDeleted",
    query: `SELECT count(*)::int AS "count" FROM "inventoryItems" WHERE "demoBatchKey" IS NULL`,
  },
  {
    key: "demoSuppliersKept",
    query: `SELECT count(*)::int AS "count" FROM "suppliers" WHERE "demoBatchKey" IS NOT NULL`,
  },
  {
    key: "manualSuppliersDeleted",
    query: `SELECT count(*)::int AS "count" FROM "suppliers" WHERE "demoBatchKey" IS NULL`,
  },
  {
    key: "unassignedWarehousesKept",
    query: `SELECT count(*)::int AS "count" FROM "warehouses"`,
  },
];

const ATTACHMENT_FILE_KEYS_QUERY = `SELECT "fileKey" AS "fileKey" FROM "attachments" WHERE "entityType" IN (${OPERATIVE_ATTACHMENT_ENTITY_TYPES_SQL})`;

const CLEANUP_STATEMENTS = [
  `DELETE FROM "attachments" WHERE "entityType" IN (${OPERATIVE_ATTACHMENT_ENTITY_TYPES_SQL})`,
  `DELETE FROM "notifications" WHERE "type" <> 'sistema'`,
  `DELETE FROM "sapSyncLog"`,
  `DELETE FROM "treasuryPaymentEvents"`,
  `DELETE FROM "treasuryPaymentItems"`,
  `DELETE FROM "treasuryPaymentBatches"`,
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
  `DELETE FROM "procurementApprovalHistory"`,
  `DELETE FROM "purchaseOrderItems"`,
  `DELETE FROM "purchaseOrders"`,
  `DELETE FROM "purchaseRequestItems"`,
  `DELETE FROM "purchaseRequests"`,
  `DELETE FROM "supplyFlowRecords"`,
  `DELETE FROM "requestItems"`,
  `DELETE FROM "materialRequests"`,
  `DELETE FROM "projectWarehouseAssignments"`,
  `DELETE FROM "userProjectAssignments" WHERE "projectId" IN (SELECT "id" FROM "projects" WHERE "demoBatchKey" IS NULL)`,
  `DELETE FROM "invitationProjectAssignments" WHERE "projectId" IN (SELECT "id" FROM "projects" WHERE "demoBatchKey" IS NULL)`,
  `UPDATE "users" SET "assignedProjectId" = NULL WHERE "assignedProjectId" IN (SELECT "id" FROM "projects" WHERE "demoBatchKey" IS NULL)`,
  `UPDATE "invitations" SET "assignedProjectId" = NULL WHERE "assignedProjectId" IN (SELECT "id" FROM "projects" WHERE "demoBatchKey" IS NULL)`,
  `UPDATE "inventoryItems" SET "currentStock" = '0.00', "updatedAt" = now() WHERE "demoBatchKey" IS NOT NULL`,
  `DELETE FROM "inventoryItems" WHERE "demoBatchKey" IS NULL`,
  `DELETE FROM "sapCatalog" WHERE "demoBatchKey" IS NULL`,
  `DELETE FROM "suppliers" WHERE "demoBatchKey" IS NULL`,
  `UPDATE "projects" SET "warehouseId" = NULL WHERE "demoBatchKey" IS NULL`,
  `DELETE FROM "projects" WHERE "demoBatchKey" IS NULL`,
] as const;

export function createDrizzleResetDemoCleanExecutor(client: {
  execute: (query: SQL) => Promise<unknown>;
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
}): ResetDemoCleanExecutor {
  return {
    async run(query: string) {
      return normalizeQueryResult(await client.execute(sql.raw(query)));
    },
    async transaction(callback) {
      return client.transaction(tx =>
        callback(createDrizzleResetDemoCleanExecutor(tx))
      );
    },
  };
}

export async function collectResetDemoCleanSnapshot(
  executor: ResetDemoCleanExecutor
): Promise<ResetDemoCleanSnapshot> {
  const counts: ResetDemoCleanCounts = {};

  for (const entry of COUNT_QUERIES) {
    const result = await executor.run(entry.query);
    counts[entry.key] = readCount(result);
  }

  const fileKeyRows =
    (await executor.run(ATTACHMENT_FILE_KEYS_QUERY)).rows ?? [];
  const attachmentFileKeys = Array.from(
    new Set(
      fileKeyRows.map(row => String(row.fileKey ?? "").trim()).filter(Boolean)
    )
  );

  return { counts, attachmentFileKeys };
}

export async function executeResetDemoClean(
  executor: ResetDemoCleanExecutor,
  options: ResetDemoCleanOptions = {}
): Promise<ResetDemoCleanResult> {
  const dryRun = options.dryRun !== false;
  const deleteStorage = options.deleteStorage !== false;

  if (dryRun) {
    const snapshot = await collectResetDemoCleanSnapshot(executor);
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
    const preflight = await collectResetDemoCleanSnapshot(executor);
    if (preflight.attachmentFileKeys.length > 0) {
      throw new Error(
        "storageDelete is required when deleting operative attachment records"
      );
    }
  }

  const snapshot = await executor.transaction(async tx => {
    const transactionSnapshot = await collectResetDemoCleanSnapshot(tx);

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
        failed: [] as ResetDemoCleanStorageFailure[],
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

export function getResetDemoCleanCleanupStatements() {
  return [...CLEANUP_STATEMENTS];
}

async function deleteStorageFiles(
  fileKeys: string[],
  options: ResetDemoCleanOptions
): Promise<ResetDemoCleanStorageResult> {
  const failed: ResetDemoCleanStorageFailure[] = [];
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

function normalizeQueryResult(result: unknown): ResetDemoCleanQueryResult {
  if (Array.isArray(result)) {
    return {
      rows: result as Array<Record<string, unknown>>,
      rowCount: result.length,
    };
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

function readCount(result: ResetDemoCleanQueryResult) {
  const raw = result.rows?.[0]?.count ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
