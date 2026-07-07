import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  executePruneCatalogToHidalgoAssets,
  getPruneCatalogCleanupStatements,
  HIDALGO_KEEP_CODE_COUNT,
  PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION,
  type PruneCatalogResult,
} from "./_core/pruneCatalogToHidalgoAssets";
import type {
  ResetOperationalMovementsExecutor,
  ResetOperationalMovementsQueryResult,
} from "./_core/resetOperationalMovements";
import {
  loadKeepCodesFromApplyReport,
  parsePruneCatalogArgs,
} from "../scripts/prune-catalog-to-hidalgo-assets";

type FakeState = {
  attachmentFileKeys: string[];
  queries: string[];
  transactions: number;
  afterCleanup: boolean;
};

const OPERATIONAL_ZERO_TABLES = [
  "materialRequests",
  "requestItems",
  "supplyFlowRecords",
  "purchaseRequests",
  "purchaseRequestItems",
  "purchaseOrders",
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
  "invoiceItems",
  "invoiceOtherCharges",
  "invoiceRetentions",
  "warehouseExits",
  "warehouseExitItems",
  "openingBalances",
  "openingBalanceItems",
  "reverseLogistics",
  "reverseLogisticsItems",
  "sapSyncLog",
];

class FakeExecutor implements ResetOperationalMovementsExecutor {
  constructor(private readonly state: FakeState) {}

  async run(query: string): Promise<ResetOperationalMovementsQueryResult> {
    this.state.queries.push(query);

    if (/^WITH[\s\S]*DELETE FROM "sapCatalog"/i.test(query.trim())) {
      this.state.afterCleanup = true;
      return { rows: [], rowCount: 1 };
    }

    if (/^WITH[\s\S]*DELETE FROM "inventoryItems"/i.test(query.trim())) {
      return { rows: [], rowCount: 1 };
    }

    if (query.startsWith('SELECT "fileKey"')) {
      return {
        rows: this.state.afterCleanup
          ? []
          : this.state.attachmentFileKeys.map(fileKey => ({ fileKey })),
        rowCount: this.state.afterCleanup ? 0 : this.state.attachmentFileKeys.length,
      };
    }

    if (query.includes('array_agg(keep."itemCode"')) {
      return { rows: [{ missingKeepCodes: [] }], rowCount: 1 };
    }

    if (query.includes('FROM "sapCatalog" catalog')) {
      return {
        rows: [
          this.state.afterCleanup
            ? {
                total: HIDALGO_KEEP_CODE_COUNT,
                keep: HIDALGO_KEEP_CODE_COUNT,
                nonKeep: 0,
                keepActive: HIDALGO_KEEP_CODE_COUNT,
                keepInactive: 0,
              }
            : {
                total: HIDALGO_KEEP_CODE_COUNT + 10,
                keep: HIDALGO_KEEP_CODE_COUNT,
                nonKeep: 10,
                keepActive: HIDALGO_KEEP_CODE_COUNT,
                keepInactive: 0,
              },
        ],
        rowCount: 1,
      };
    }

    if (query.includes('FROM "inventoryItems" inventory')) {
      return {
        rows: [
          this.state.afterCleanup
            ? { total: 0, keep: 0, nonKeep: 0 }
            : { total: 10, keep: 0, nonKeep: 10 },
        ],
        rowCount: 1,
      };
    }

    if (query.startsWith("SELECT count")) {
      if (this.state.afterCleanup && shouldBeZeroAfterCleanup(query)) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      if (query.includes('FROM "sapCatalog"')) {
        return {
          rows: [{ count: this.state.afterCleanup ? HIDALGO_KEEP_CODE_COUNT : HIDALGO_KEEP_CODE_COUNT + 10 }],
          rowCount: 1,
        };
      }
      if (query.includes('FROM "inventoryItems"')) {
        return { rows: [{ count: this.state.afterCleanup ? 0 : 10 }], rowCount: 1 };
      }
      return { rows: [{ count: 1 }], rowCount: 1 };
    }

    return { rows: [], rowCount: 1 };
  }

  async transaction<T>(
    callback: (tx: ResetOperationalMovementsExecutor) => Promise<T>
  ): Promise<T> {
    this.state.transactions += 1;
    return callback(new FakeExecutor(this.state));
  }
}

function shouldBeZeroAfterCleanup(query: string) {
  return (
    OPERATIONAL_ZERO_TABLES.some(table => query.includes(`FROM "${table}"`)) ||
    query.includes(`FROM "notifications" WHERE "type" <> 'sistema'`) ||
    query.includes(`FROM "attachments" WHERE "entityType"`) ||
    query.includes(`FROM "supplierFiscalDocumentRanges" WHERE "sourceInvoiceId" IS NOT NULL`)
  );
}

function createFakeExecutor(attachmentFileKeys: string[] = []) {
  const state: FakeState = {
    attachmentFileKeys,
    queries: [],
    transactions: 0,
    afterCleanup: false,
  };

  return { executor: new FakeExecutor(state), state };
}

function makeKeepCodes(count = HIDALGO_KEEP_CODE_COUNT) {
  return Array.from({ length: count }, (_, index) =>
    `HID${String(index + 1).padStart(4, "0")}`
  );
}

function mutationQueries(queries: string[]) {
  return queries.filter(query => {
    const trimmed = query.trim();
    return (
      /^(DELETE|UPDATE)\b/i.test(trimmed) ||
      (/^WITH\b/i.test(trimmed) && /\bDELETE\b/i.test(trimmed))
    );
  });
}

describe("prune-catalog-to-hidalgo-assets", () => {
  it("keeps dry-run read-only", async () => {
    const { executor, state } = createFakeExecutor(["buildreq/invoice/1/a.pdf"]);

    const result = await executePruneCatalogToHidalgoAssets(
      executor,
      makeKeepCodes(),
      { dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.before.catalog.nonKeep).toBe(10);
    expect(result.before.inventory.nonKeep).toBe(10);
    expect(result.storage.attempted).toBe(0);
    expect(state.transactions).toBe(0);
    expect(mutationQueries(state.queries)).toHaveLength(0);
  });

  it("requires exactly 461 unique keep codes", async () => {
    const { executor } = createFakeExecutor();

    await expect(
      executePruneCatalogToHidalgoAssets(executor, makeKeepCodes(460))
    ).rejects.toThrow("461 codigos");

    await expect(
      executePruneCatalogToHidalgoAssets(executor, [
        ...makeKeepCodes(460),
        "HID0001",
      ])
    ).rejects.toThrow("duplicados");
  });

  it("requires the exact confirmation phrase in the CLI parser", () => {
    expect(parsePruneCatalogArgs([]).dryRun).toBe(true);
    expect(
      parsePruneCatalogArgs([
        "--confirm",
        PRUNE_CATALOG_TO_HIDALGO_CONFIRMATION,
      ]).dryRun
    ).toBe(false);
    expect(() =>
      parsePruneCatalogArgs(["--confirm", "BORRAR"])
    ).toThrow("Confirmacion invalida");
  });

  it("loads keep codes from the Hidalgo apply report shape", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "buildreq-prune-report-"));
    const reportPath = join(tempDir, "apply.json");

    try {
      await writeFile(
        reportPath,
        JSON.stringify({
          insertedRows: makeKeepCodes().map(itemCode => ({ itemCode })),
        }),
        "utf8"
      );

      await expect(loadKeepCodesFromApplyReport(reportPath)).resolves.toEqual(
        makeKeepCodes()
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("deletes operational data before deleting inventory and catalog", async () => {
    const keepCodes = makeKeepCodes();
    const statements = getPruneCatalogCleanupStatements(keepCodes);
    const purchaseOrderDeleteIndex = statements.findIndex(statement =>
      statement.includes('DELETE FROM "purchaseOrders"')
    );
    const inventoryDeleteIndex = statements.findIndex(statement =>
      statement.includes('DELETE FROM "inventoryItems"')
    );
    const catalogDeleteIndex = statements.findIndex(statement =>
      statement.includes('DELETE FROM "sapCatalog"')
    );

    expect(purchaseOrderDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(inventoryDeleteIndex).toBeGreaterThan(purchaseOrderDeleteIndex);
    expect(catalogDeleteIndex).toBeGreaterThan(inventoryDeleteIndex);
    expect(statements.some(statement => statement.includes('"users"'))).toBe(false);
    expect(statements.some(statement => statement.includes('"projects"'))).toBe(false);
    expect(statements.some(statement => statement.includes('"warehouses"'))).toBe(false);
    expect(statements.some(statement => statement.includes('"suppliers"'))).toBe(false);
  });

  it("executes physical prune and verifies the resulting counts", async () => {
    const { executor, state } = createFakeExecutor([
      "buildreq/invoice/1/a.pdf",
      "buildreq/purchase_order/2/b.pdf",
    ]);
    const storageDelete = vi.fn(async (_fileKey: string) => undefined);

    const result = await executePruneCatalogToHidalgoAssets(
      executor,
      makeKeepCodes(),
      { dryRun: false, storageDelete }
    );

    expect(result.dryRun).toBe(false);
    expect(state.transactions).toBe(1);
    expect(result.after?.catalog.total).toBe(HIDALGO_KEEP_CODE_COUNT);
    expect(result.after?.catalog.nonKeep).toBe(0);
    expect(result.after?.inventory.nonKeep).toBe(0);
    expect(result.verificationProblems).toEqual([]);
    expect(storageDelete).toHaveBeenCalledTimes(2);

    const mutations = mutationQueries(state.queries);
    expect(mutations.some(query => query.includes('DELETE FROM "inventoryItems"'))).toBe(
      true
    );
    expect(mutations.some(query => query.includes('DELETE FROM "sapCatalog"'))).toBe(
      true
    );
    expect(mutations.some(query => query.includes('"users"'))).toBe(false);
    expect(mutations.some(query => query.includes('"projects"'))).toBe(false);
    expect(mutations.some(query => query.includes('"warehouses"'))).toBe(false);
    expect(mutations.some(query => query.includes('"suppliers"'))).toBe(false);
  });

  it("requires a storage deleter when operational attachment records exist", async () => {
    const { executor, state } = createFakeExecutor(["buildreq/invoice/1/a.pdf"]);

    await expect(
      executePruneCatalogToHidalgoAssets(executor, makeKeepCodes(), {
        dryRun: false,
      })
    ).rejects.toThrow("storageDelete is required");

    expect(state.transactions).toBe(0);
  });

  it("writes storage failure report after DB cleanup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "buildreq-prune-storage-"));
    const failureReportPath = join(tempDir, "storage-failures.json");
    const { executor } = createFakeExecutor([
      "buildreq/invoice/1/good.pdf",
      "buildreq/invoice/2/bad.pdf",
    ]);
    const storageDelete = vi.fn(async (fileKey: string) => {
      if (fileKey.includes("bad")) {
        throw new Error("storage unavailable");
      }
    });

    try {
      const result: PruneCatalogResult = await executePruneCatalogToHidalgoAssets(
        executor,
        makeKeepCodes(),
        {
          dryRun: false,
          storageDelete,
          storageDeleteRetries: 2,
          failureReportPath,
        }
      );

      expect(result.storage.attempted).toBe(2);
      expect(result.storage.deleted).toBe(1);
      expect(result.storage.failed).toEqual([
        {
          fileKey: "buildreq/invoice/2/bad.pdf",
          error: "storage unavailable",
        },
      ]);
      expect(result.storage.failureReportPath).toBe(failureReportPath);

      const report = JSON.parse(await readFile(failureReportPath, "utf8"));
      expect(report.failed).toEqual(result.storage.failed);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
