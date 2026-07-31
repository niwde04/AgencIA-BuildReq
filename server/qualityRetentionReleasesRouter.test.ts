import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import * as releases from "./qualityRetentionReleases";
import { appRouter } from "./routers";

type TestRole =
  | "administrador_proyecto"
  | "administracion_central"
  | "contable";

function createContext(buildreqRole: TestRole, projectIds: number[] = []) {
  return {
    user: {
      id: buildreqRole === "administrador_proyecto" ? 10 : 20,
      openId: `quality-${buildreqRole}`,
      email: `${buildreqRole}@example.com`,
      name: buildreqRole,
      loginMethod: "test",
      role: "user",
      buildreqRole,
      assignedProjectId: projectIds[0] ?? null,
      assignedProjectIds: projectIds,
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

function invoiceDetail(projectId = 2) {
  return {
    invoice: {
      id: 50,
      projectId,
      status: "registrada",
      invoiceDocumentNumber: "FT-020-00000050",
    },
    items: [],
    retentions: [],
    otherCharges: [],
    documentAdjustments: [],
  } as any;
}

afterEach(() => vi.restoreAllMocks());

describe("quality retention release permissions", () => {
  it("allows the assigned project administrator to request", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(invoiceDetail());
    vi.spyOn(db, "getUsersByBuildreqRole").mockResolvedValue([]);
    const requestSpy = vi
      .spyOn(releases, "requestQualityRetentionRelease")
      .mockResolvedValue({ id: 7, requestedById: 10 } as any);

    await appRouter
      .createCaller(createContext("administrador_proyecto", [2]))
      .qualityRetentionReleases.request({
        invoiceId: 50,
        requestedAmount: 100,
        justification: "La obra fue recibida conforme.",
      });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 50,
        requestedAmount: 100,
        requestedById: 10,
      })
    );
  });

  it("blocks project users from other projects", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(invoiceDetail(3));
    const requestSpy = vi.spyOn(releases, "requestQualityRetentionRelease");

    await expect(
      appRouter
        .createCaller(createContext("administrador_proyecto", [2]))
        .qualityRetentionReleases.request({
          invoiceId: 50,
          requestedAmount: 100,
          justification: "La obra fue recibida conforme.",
        })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("allows Central to reduce an approval and blocks project approval", async () => {
    const decideSpy = vi
      .spyOn(releases, "decideQualityRetentionRelease")
      .mockResolvedValue({
        id: 7,
        requestedById: 10,
        approvedAmount: "75.0000",
      } as any);
    vi.spyOn(db, "getUserById").mockResolvedValue(undefined);

    await appRouter
      .createCaller(createContext("administracion_central"))
      .qualityRetentionReleases.decide({
        releaseId: 7,
        approved: true,
        approvedAmount: 75,
        comment: "Se autoriza un monto parcial.",
      });
    expect(decideSpy).toHaveBeenCalledWith(
      expect.objectContaining({ approvedAmount: 75, decidedById: 20 })
    );

    await expect(
      appRouter
        .createCaller(createContext("administrador_proyecto", [2]))
        .qualityRetentionReleases.decide({
          releaseId: 7,
          approved: false,
          comment: "No corresponde autorizar todavía.",
        })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
