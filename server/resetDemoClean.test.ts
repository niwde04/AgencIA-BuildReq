import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  executeResetDemoClean,
  getResetDemoCleanCleanupStatements,
  type ResetDemoCleanExecutor,
  type ResetDemoCleanQueryResult,
} from "./_core/resetDemoClean";

type FakeExecutorState = {
  queries: string[];
  transactionQueries: string[];
  transactionCalls: number;
  attachmentFileKeys: string[];
};

class FakeResetExecutor implements ResetDemoCleanExecutor {
  constructor(
    private readonly state: FakeExecutorState,
    private readonly inTransaction = false
  ) {}

  async run(query: string): Promise<ResetDemoCleanQueryResult> {
    const target = this.inTransaction
      ? this.state.transactionQueries
      : this.state.queries;
    target.push(query);

    if (query.startsWith('SELECT "fileKey"')) {
      return {
        rows: this.state.attachmentFileKeys.map((fileKey) => ({ fileKey })),
        rowCount: this.state.attachmentFileKeys.length,
      };
    }

    if (query.includes("count(*)")) {
      return { rows: [{ count: 1 }], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  async transaction<T>(
    callback: (tx: ResetDemoCleanExecutor) => Promise<T>
  ): Promise<T> {
    this.state.transactionCalls += 1;
    return callback(new FakeResetExecutor(this.state, true));
  }
}

function createFakeExecutor(attachmentFileKeys: string[] = []) {
  const state: FakeExecutorState = {
    queries: [],
    transactionQueries: [],
    transactionCalls: 0,
    attachmentFileKeys,
  };

  return {
    executor: new FakeResetExecutor(state),
    state,
  };
}

function isMutation(query: string) {
  return /^(DELETE|UPDATE)\b/i.test(query.trim());
}

describe("reset-demo-clean", () => {
  it("reports dry-run counts and does not mutate data", async () => {
    const { executor, state } = createFakeExecutor([
      "buildreq/material_request/1/doc.pdf",
      "buildreq/purchase_order/2/oc.pdf",
    ]);

    const result = await executeResetDemoClean(executor, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.attachmentFileKeys).toHaveLength(2);
    expect(result.storage.attempted).toBe(0);
    expect(state.transactionCalls).toBe(0);
    expect([...state.queries, ...state.transactionQueries].some(isMutation)).toBe(
      false
    );
  });

  it("cleans operational data, keeps users, resets demo inventory, and deletes storage files", async () => {
    const attachmentFileKeys = [
      "buildreq/material_request/1/doc.pdf",
      "buildreq/purchase_order/2/oc.pdf",
    ];
    const { executor, state } = createFakeExecutor(attachmentFileKeys);
    const storageDelete = vi.fn(async (_fileKey: string) => undefined);

    const result = await executeResetDemoClean(executor, {
      dryRun: false,
      storageDelete,
    });

    const mutationQueries = state.transactionQueries.filter(isMutation);

    expect(result.dryRun).toBe(false);
    expect(state.transactionCalls).toBe(1);
    expect(mutationQueries).toEqual(getResetDemoCleanCleanupStatements());
    expect(mutationQueries.some((query) => query.includes('DELETE FROM "users"'))).toBe(
      false
    );
    expect(mutationQueries.join("\n")).toContain(
      'UPDATE "users" SET "assignedProjectId" = NULL'
    );
    expect(mutationQueries.join("\n")).toContain(
      'UPDATE "invitations" SET "assignedProjectId" = NULL'
    );
    expect(mutationQueries.join("\n")).toContain(
      `UPDATE "inventoryItems" SET "currentStock" = '0.00'`
    );
    expect(mutationQueries.join("\n")).not.toContain("minimumStock");
    expect(mutationQueries.join("\n")).toContain(
      'DELETE FROM "projects" WHERE "demoBatchKey" IS NULL'
    );
    expect(storageDelete).toHaveBeenCalledTimes(2);
    expect(storageDelete).toHaveBeenNthCalledWith(1, attachmentFileKeys[0]);
    expect(storageDelete).toHaveBeenNthCalledWith(2, attachmentFileKeys[1]);
  });

  it("writes a storage failure report after the DB transaction commits", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "buildreq-reset-demo-clean-"));
    const failureReportPath = join(tempDir, "reset-storage-failures.json");

    try {
      const { executor } = createFakeExecutor([
        "buildreq/material_request/1/good.pdf",
        "buildreq/purchase_order/2/bad.pdf",
      ]);
      const storageDelete = vi.fn(async (fileKey: string) => {
        if (fileKey.includes("bad")) {
          throw new Error("storage unavailable");
        }
      });

      const result = await executeResetDemoClean(executor, {
        dryRun: false,
        storageDelete,
        storageDeleteRetries: 2,
        failureReportPath,
      });

      expect(result.storage.attempted).toBe(2);
      expect(result.storage.deleted).toBe(1);
      expect(result.storage.failed).toEqual([
        {
          fileKey: "buildreq/purchase_order/2/bad.pdf",
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
});
