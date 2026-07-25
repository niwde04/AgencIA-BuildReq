import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import * as treasury from "./treasury";

function createTreasuryContext(
  buildreqRole: "administracion_central" | "financiero"
) {
  return {
    user: {
      id: buildreqRole === "financiero" ? 20 : 21,
      openId: `test-${buildreqRole}`,
      email: `${buildreqRole}@example.com`,
      name:
        buildreqRole === "financiero"
          ? "Financiero Test"
          : "Administración Central Test",
      loginMethod: "test",
      role: "user",
      buildreqRole,
      assignedProjectId: null,
      assignedProjectIds: [],
      assignedProjects: [],
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: vi.fn() },
  } as unknown as TrpcContext;
}

function mockDisabledApprovalSettings() {
  return vi.spyOn(treasury, "getTreasurySettings").mockResolvedValue({
    treasuryEnabled: true,
    treasuryBatchApprovalsEnabled: false,
    updatedAt: new Date(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("treasury approval endpoint preconditions", () => {
  it.each(["approve", "reject"] as const)(
    "blocks %s while batch approvals are disabled",
    async operation => {
      mockDisabledApprovalSettings();
      vi.spyOn(treasury, "getTreasuryBatchById").mockResolvedValue({
        batch: { id: 40, projectId: 1 },
      } as any);
      const approveSpy = vi.spyOn(treasury, "approveTreasuryBatch");
      const rejectSpy = vi.spyOn(treasury, "rejectTreasuryBatch");
      const caller = appRouter.createCaller(
        createTreasuryContext("financiero")
      );

      const request =
        operation === "approve"
          ? caller.treasury.approve({ id: 40 })
          : caller.treasury.reject({
              id: 40,
              reason: "No corresponde pagar este lote",
            });

      await expect(request).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(approveSpy).not.toHaveBeenCalled();
      expect(rejectSpy).not.toHaveBeenCalled();
    }
  );

  it("blocks consolidation before changing any batch", async () => {
    mockDisabledApprovalSettings();
    const consolidateSpy = vi.spyOn(
      treasury,
      "consolidateTreasuryBatchesForApproval"
    );
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    await expect(
      caller.treasury.consolidateForApproval({ batchIds: [40, 41] })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(consolidateSpy).not.toHaveBeenCalled();
  });
});
