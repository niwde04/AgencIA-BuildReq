import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  executeResetOperationalMovements,
  getResetOperationalMovementsCleanupStatements,
  RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION,
  type ResetOperationalMovementsExecutor,
  type ResetOperationalMovementsQueryResult,
} from "./_core/resetOperationalMovements";
import {
  createOperationalMovementsBackup,
  parseResetOperationalMovementsArgs,
} from "../scripts/reset-operational-movements";

type FakeState = {
  attachmentFileKeys: string[];
  queries: string[];
  transactions: number;
};

class FakeExecutor implements ResetOperationalMovementsExecutor {
  constructor(private readonly state: FakeState) {}

  async run(query: string): Promise<ResetOperationalMovementsQueryResult> {
    this.state.queries.push(query);

    if (query.startsWith('SELECT "fileKey"')) {
      return {
        rows: this.state.attachmentFileKeys.map(fileKey => ({ fileKey })),
        rowCount: this.state.attachmentFileKeys.length,
      };
    }

    if (query.startsWith("SELECT count")) {
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

function createFakeExecutor(attachmentFileKeys: string[] = []) {
  const state: FakeState = {
    attachmentFileKeys,
    queries: [],
    transactions: 0,
  };

  return { executor: new FakeExecutor(state), state };
}

function mutationQueries(queries: string[]) {
  return queries.filter(query => /^(DELETE|UPDATE)\b/i.test(query));
}

describe("reset-operational-movements", () => {
  it("keeps dry-run read-only", async () => {
    const { executor, state } = createFakeExecutor([
      "buildreq/material_request/1/a.pdf",
      "buildreq/invoice/2/b.pdf",
    ]);

    const result = await executeResetOperationalMovements(executor, {
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.attachmentFileKeys).toHaveLength(2);
    expect(result.storage.attempted).toBe(0);
    expect(state.transactions).toBe(0);
    expect(mutationQueries(state.queries)).toHaveLength(0);
  });

  it("deletes operational movements, zeroes inventory stock, and keeps master data", async () => {
    const attachmentFileKeys = [
      "buildreq/material_request/1/a.pdf",
      "buildreq/invoice/2/b.pdf",
    ];
    const { executor, state } = createFakeExecutor(attachmentFileKeys);
    const storageDelete = vi.fn(async (_fileKey: string) => undefined);

    const result = await executeResetOperationalMovements(executor, {
      dryRun: false,
      storageDelete,
    });

    expect(result.dryRun).toBe(false);
    expect(state.transactions).toBe(1);
    expect(storageDelete).toHaveBeenCalledTimes(2);
    expect(storageDelete).toHaveBeenNthCalledWith(1, attachmentFileKeys[0]);
    expect(storageDelete).toHaveBeenNthCalledWith(2, attachmentFileKeys[1]);

    const mutations = mutationQueries(state.queries);
    expect(mutations).toEqual(
      expect.arrayContaining([
        `DELETE FROM "invoiceRetentions"`,
        `DELETE FROM "invoiceOtherCharges"`,
        `UPDATE "supplierFiscalDocumentRanges" SET "sourceInvoiceId" = NULL WHERE "sourceInvoiceId" IS NOT NULL`,
        `DELETE FROM "invoiceItems"`,
        `DELETE FROM "invoices"`,
        `DELETE FROM "receiptOtherCharges"`,
        `DELETE FROM "purchaseOrderAuditLogs"`,
        `DELETE FROM "warehouseExits"`,
        `DELETE FROM "openingBalances"`,
        `DELETE FROM "materialRequests"`,
        `UPDATE "inventoryItems" SET "currentStock" = '0.00', "updatedAt" = now() WHERE "currentStock" <> '0.00'`,
      ])
    );
    expect(mutations.some(query => query.includes('"sapCatalog"'))).toBe(false);
    expect(mutations.some(query => query.includes('"suppliers"'))).toBe(false);
    expect(mutations.some(query => query.includes('"projects"'))).toBe(false);
    expect(mutations.some(query => query.includes('"warehouses"'))).toBe(false);
    expect(mutations.some(query => query.includes('"users"'))).toBe(false);
    expect(mutations.some(query => query.includes('"projectWarehouseAssignments"'))).toBe(
      false
    );
  });

  it("does not delete supplier attachments", () => {
    const statements = getResetOperationalMovementsCleanupStatements();
    const attachmentDelete = statements.find(statement =>
      statement.startsWith('DELETE FROM "attachments"')
    );

    expect(attachmentDelete).toBeTruthy();
    expect(attachmentDelete).toContain("'invoice'");
    expect(attachmentDelete).toContain("'purchase_order'");
    expect(attachmentDelete).not.toContain("'supplier'");
  });

  it("requires a storage deleter when operational attachment records exist", async () => {
    const { executor, state } = createFakeExecutor([
      "buildreq/purchase_order/1/a.pdf",
    ]);

    await expect(
      executeResetOperationalMovements(executor, { dryRun: false })
    ).rejects.toThrow("storageDelete is required");

    expect(state.transactions).toBe(0);
    expect(mutationQueries(state.queries)).toHaveLength(0);
  });

  it("writes a storage failure report after the DB transaction commits", async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), "buildreq-reset-operational-movements-")
    );
    const failureReportPath = join(tempDir, "storage-failures.json");

    try {
      const { executor } = createFakeExecutor([
        "buildreq/invoice/1/good.pdf",
        "buildreq/invoice/2/bad.pdf",
      ]);
      const storageDelete = vi.fn(async (fileKey: string) => {
        if (fileKey.includes("bad")) {
          throw new Error("storage unavailable");
        }
      });

      const result = await executeResetOperationalMovements(executor, {
        dryRun: false,
        storageDelete,
        storageDeleteRetries: 2,
        failureReportPath,
      });

      expect(result.storage.attempted).toBe(2);
      expect(result.storage.deleted).toBe(1);
      expect(result.storage.failed).toEqual([
        {
          fileKey: "buildreq/invoice/2/bad.pdf",
          error: "storage unavailable",
        },
      ]);
      expect(result.storage.failureReportPath).toBe(failureReportPath);
      expect(storageDelete).toHaveBeenCalledTimes(3);

      const report = JSON.parse(await readFile(failureReportPath, "utf8"));
      expect(report.failed).toEqual(result.storage.failed);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires the exact confirmation phrase to execute", () => {
    expect(parseResetOperationalMovementsArgs([]).dryRun).toBe(true);
    expect(
      parseResetOperationalMovementsArgs([
        "--confirm",
        RESET_OPERATIONAL_MOVEMENTS_CONFIRMATION,
      ]).dryRun
    ).toBe(false);
    expect(() =>
      parseResetOperationalMovementsArgs(["--confirm", "RESET"])
    ).toThrow("Confirmacion invalida");
  });

  it("fails with backup diagnostics before execution when backup cannot be created", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "buildreq-backup-failure-"));

    try {
      await expect(
        createOperationalMovementsBackup(
          "postgres://user:pass@localhost:5432/buildreq",
          tempDir,
          "pg_dump-buildreq-missing"
        )
      ).rejects.toThrow(
        /No se pudo crear el backup obligatorio.*pg_dump.*DATABASE_URL/s
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
