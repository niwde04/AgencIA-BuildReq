import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createScopedContext() {
  return {
    user: {
      id: 70,
      openId: "project-assignment-ledger-test",
      email: "ledger@example.com",
      name: "Administrador de proyecto",
      loginMethod: "test",
      role: "user",
      buildreqRole: "administrador_proyecto",
      assignedProjectId: 7,
      assignedProjectIds: [7],
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

describe("project assignment ledger router permissions", () => {
  it("blocks every ledger endpoint for a project outside the user's scope", async () => {
    const caller = appRouter.createCaller(createScopedContext());
    const selection = {
      projectId: 8,
      targetType: "subproyecto" as const,
      targetKey: "1",
    };

    await expect(
      caller.projects.listAssignmentTargets({
        projectId: 8,
        targetType: "subproyecto",
        page: 1,
        pageSize: 10,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.projects.getAssignmentLedger({
        ...selection,
        historyPage: 1,
        historyPageSize: 10,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.projects.exportAssignmentLedger(selection)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
