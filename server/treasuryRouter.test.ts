import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import * as db from "./db";
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

  it("allows Administración Central to consolidate while approvals are disabled", async () => {
    mockDisabledApprovalSettings();
    vi.spyOn(treasury, "getTreasuryBatchById").mockImplementation(
      async batchId =>
        ({
          batch: { id: batchId, projectId: batchId },
          projectIds: [batchId],
        }) as any
    );
    const consolidateSpy = vi
      .spyOn(treasury, "consolidateTreasuryBatchesForApproval")
      .mockResolvedValue({
        batchId: 42,
        batchNumber: "TES-2026-000042",
        sourceBatchIds: [40, 41],
        sourceBatchNumbers: ["TES-2026-000040", "TES-2026-000041"],
        currency: "HNL",
        consolidated: true,
        approvalBypassed: true,
        status: "aprobado",
      });
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    await expect(
      caller.treasury.consolidateForApproval({ batchIds: [40, 41] })
    ).resolves.toMatchObject({
      batchId: 42,
      consolidated: true,
      approvalBypassed: true,
    });
    expect(consolidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        batchIds: [40, 41],
        actor: expect.objectContaining({
          buildreqRole: "administracion_central",
        }),
      })
    );
  });
});

describe("treasury draft permissions", () => {
  it("allows Administración Central to create and manage treasury drafts", async () => {
    mockDisabledApprovalSettings();
    const createSpy = vi
      .spyOn(treasury, "createTreasuryBatch")
      .mockResolvedValue({ id: 70 } as any);
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    const settings = await caller.treasury.settings();
    expect(settings.permissions.canCreate).toBe(true);

    await caller.treasury.create({
      projectId: 1,
      currency: "HNL",
      requestedPaymentDate: "2026-07-31",
      items: [{ invoiceId: 50, requestedAmount: 100 }],
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        currency: "HNL",
        actor: expect.objectContaining({
          buildreqRole: "administracion_central",
        }),
      })
    );
  });
});

describe("treasury invoice summary report", () => {
  it("allows Financiero to export one row per filtered invoice", async () => {
    mockDisabledApprovalSettings();
    const invoiceSpy = vi
      .spyOn(db, "listDmcReportSourceInvoices")
      .mockResolvedValue([
        {
          invoiceId: 50,
          invoiceDocumentNumber: "FT-020-00000050",
          invoiceNumber: "000-001-01-00000050",
          status: "registrada",
          documentDate: new Date("2026-07-15T12:00:00.000Z"),
          documentDueDate: new Date("2026-08-15T12:00:00.000Z"),
          subtotal: "100.0000",
          taxAmount: "15.0000",
          total: "115.0000",
          retentionTotal: "1.1500",
          netPayable: "113.8500",
          currency: "HNL",
          items: [
            {
              id: 1,
              itemName: "Artículo A",
              taxCode: "isv_15",
              subtotal: "100.0000",
              taxAmount: "15.0000",
              total: "115.0000",
              taxBreakdown: [],
              dmcDestination: "costo",
            },
          ],
          retentions: [],
          materialRequests: [],
          subProjectLabels: [],
        } as any,
      ]);
    const caller = appRouter.createCaller(createTreasuryContext("financiero"));

    const payload = await caller.treasury.invoiceSummaryReport({
      status: "registrada",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    });

    expect(invoiceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ["registrada"],
        dateFrom: expect.any(Date),
        dateTo: expect.any(Date),
      })
    );
    expect(payload.summary.invoiceCount).toBe(1);
    expect(payload.invoices).toHaveLength(1);
    expect(payload.invoices[0]).toMatchObject({
      "Documento interno": "FT-020-00000050",
      Estado: "Contabilizada",
      "Total factura": 115,
      "Neto a pagar": 113.85,
    });
  });
});

describe("treasury payment detail report", () => {
  it("returns the paid batch data used to print the supplier report", async () => {
    mockDisabledApprovalSettings();
    vi.spyOn(treasury, "getTreasuryBatchById").mockResolvedValue({
      batch: { id: 81, projectId: 17 },
    } as any);
    const reportSpy = vi
      .spyOn(treasury, "getTreasuryPaymentDetailReport")
      .mockResolvedValue({
        generatedAt: new Date("2026-07-27T15:00:00.000Z"),
        batch: {
          id: 81,
          batchNumber: "TES-2026-000081",
          status: "pendiente_contabilizacion",
          currency: "HNL",
          requestedPaymentDate: new Date("2026-07-26T00:00:00.000Z"),
        },
        project: {
          id: 17,
          code: "017",
          name: "CA-4 Ocotepeque - El Portillo",
        },
        lines: [],
      } as any);
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    const result = await caller.treasury.paymentDetailReport({ id: 81 });

    expect(reportSpy).toHaveBeenCalledWith(81);
    expect(result).toMatchObject({
      batch: {
        batchNumber: "TES-2026-000081",
        status: "pendiente_contabilizacion",
      },
      project: { code: "017" },
    });
  });
});

describe("treasury bank payment registration", () => {
  it("passes the selected payment date to the treasury service", async () => {
    mockDisabledApprovalSettings();
    vi.spyOn(treasury, "getTreasuryBatchById").mockResolvedValue({
      batch: { id: 81, projectId: 17 },
    } as any);
    const recordSpy = vi
      .spyOn(treasury, "recordTreasuryBankResponse")
      .mockResolvedValue({ id: 81 } as any);
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    await caller.treasury.recordBankResponse({
      id: 81,
      bankReference: "REF-2026-001",
      paidDate: "2026-07-25",
      attachment: {
        fileName: "comprobante.pdf",
        mimeType: "application/pdf",
        base64: Buffer.from("%PDF-1.4").toString("base64"),
      },
    });

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 81,
        bankReference: "REF-2026-001",
        paidDate: new Date("2026-07-25T00:00:00.000Z"),
      })
    );
  });
});
