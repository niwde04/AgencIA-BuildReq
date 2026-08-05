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

  it("creates an advance-only batch with the discriminated source", async () => {
    mockDisabledApprovalSettings();
    const createSpy = vi
      .spyOn(treasury, "createTreasuryBatch")
      .mockResolvedValue({ id: 71 } as any);
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    await caller.treasury.create({
      projectId: 1,
      currency: "HNL",
      paymentKind: "purchase_order_advance",
      requestedPaymentDate: "2026-07-31",
      items: [
        {
          sourceType: "purchase_order_advance",
          purchaseOrderAdvanceId: 90,
          requestedAmount: 250,
        },
      ],
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentKind: "purchase_order_advance",
        items: [
          {
            sourceType: "purchase_order_advance",
            purchaseOrderAdvanceId: 90,
            requestedAmount: 250,
          },
        ],
      })
    );
  });

  it("creates a quality-retention-release-only batch", async () => {
    mockDisabledApprovalSettings();
    const createSpy = vi
      .spyOn(treasury, "createTreasuryBatch")
      .mockResolvedValue({ id: 72 } as any);
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    await caller.treasury.create({
      projectId: 1,
      currency: "HNL",
      paymentKind: "quality_retention_release",
      requestedPaymentDate: "2026-07-31",
      items: [
        {
          sourceType: "quality_retention_release",
          qualityRetentionReleaseId: 12,
          requestedAmount: 125,
        },
      ],
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentKind: "quality_retention_release",
        items: [
          {
            sourceType: "quality_retention_release",
            qualityRetentionReleaseId: 12,
            requestedAmount: 125,
          },
        ],
      })
    );
  });

  it("lists eligible advances separately from invoices", async () => {
    mockDisabledApprovalSettings();
    const listSpy = vi
      .spyOn(treasury, "listEligibleTreasuryAdvances")
      .mockResolvedValue([] as any);
    const caller = appRouter.createCaller(
      createTreasuryContext("administracion_central")
    );

    await caller.treasury.eligibleAdvances({
      projectId: 1,
      currency: "HNL",
    });

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        currency: "HNL",
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
          otherRetentionTotal: "5.0000",
          documentDiscountTotal: "3.2000",
          netPayable: "105.6500",
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
          documentAdjustments: [
            {
              adjustmentType: "quality_retention",
              percentage: "5.00",
              baseAmount: "100.0000",
              amount: "5.0000",
            },
            {
              adjustmentType: "prompt_payment_discount",
              percentage: "2.00",
              baseAmount: "100.0000",
              amount: "2.0000",
            },
            {
              adjustmentType: "tc_discount",
              percentage: "8.00",
              baseAmount: "15.0000",
              amount: "1.2000",
            },
          ],
          materialRequests: [],
          subProjectLabels: [],
        } as any,
      ]);
    vi.spyOn(treasury, "getTreasuryInvoiceReportPayments").mockResolvedValue(
      new Map([
        [
          50,
          [
            {
              batchId: 49,
              batchNumber: "TES-2026-000049",
              paidDate: new Date("2026-07-19T12:00:00.000Z"),
              bankReference: "REF-2026-049",
              amount: 40,
            },
            {
              batchId: 50,
              batchNumber: "TES-2026-000050",
              paidDate: new Date("2026-07-20T12:00:00.000Z"),
              bankReference: "REF-2026-050",
              amount: 65.65,
            },
          ],
        ],
      ])
    );
    const caller = appRouter.createCaller(createTreasuryContext("financiero"));

    const payload = await caller.treasury.invoiceSummaryReport({
      paymentStatus: "paid",
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
      Estado: "Pagado",
      "Lote de pago": "TES-2026-000049, TES-2026-000050",
      "Fecha de pago": new Date("2026-07-20T12:00:00.000Z"),
      "Referencia de pago": "REF-2026-049, REF-2026-050",
      "Monto pagado": 105.65,
      navigation: {
        invoiceId: 50,
        paymentBatches: [
          { id: 49, batchNumber: "TES-2026-000049" },
          { id: 50, batchNumber: "TES-2026-000050" },
        ],
      },
      "Total factura": 115,
      "Retenciones fiscales": 1.15,
      "Retención calidad %": 5,
      "Retención calidad": 5,
      "Pronto pago": 2,
      TC: 1.2,
      "Otras retenciones": 5,
      "Descuentos documento": 3.2,
      "Neto a pagar": 105.65,
    });
  });

  it("filters all, pending, partial and paid registered invoices", async () => {
    mockDisabledApprovalSettings();
    const sourceInvoices = [
      { invoiceId: 61, invoiceDocumentNumber: "FT-00000061" },
      { invoiceId: 62, invoiceDocumentNumber: "FT-00000062" },
      { invoiceId: 63, invoiceDocumentNumber: "FT-00000063" },
    ].map(invoice => ({
      ...invoice,
      status: "registrada",
      subtotal: "100.0000",
      taxAmount: "0.0000",
      total: "100.0000",
      retentionTotal: "0.0000",
      otherRetentionTotal: "0.0000",
      documentDiscountTotal: "0.0000",
      netPayable: "100.0000",
      currency: "HNL" as const,
      items: [],
      retentions: [],
      documentAdjustments: [],
      materialRequests: [],
      subProjectLabels: [],
    }));
    const invoiceSpy = vi
      .spyOn(db, "listDmcReportSourceInvoices")
      .mockImplementation(async filters => {
        const invoiceIds = filters?.invoiceIds;
        return (
          invoiceIds
            ? sourceInvoices.filter(invoice =>
                invoiceIds.includes(invoice.invoiceId)
              )
            : sourceInvoices
        ) as any;
      });
    const pageSpy = vi
      .spyOn(treasury, "listTreasuryInvoiceReportPage")
      .mockImplementation(async input => {
        const invoiceIds = input.page === 1 ? [61, 62] : [63];
        return {
          invoiceIds,
          page: input.page,
          pageSize: input.pageSize,
          total: 3,
          totalPages: 2,
        };
      });
    vi.spyOn(treasury, "getTreasuryInvoiceReportPayments").mockResolvedValue(
      new Map([
        [61, []],
        [
          62,
          [
            {
              batchId: 62,
              batchNumber: "TES-2026-000062",
              paidDate: new Date("2026-07-21T12:00:00.000Z"),
              bankReference: "REF-2026-062",
              amount: 40,
            },
          ],
        ],
        [
          63,
          [
            {
              batchId: 63,
              batchNumber: "TES-2026-000063",
              paidDate: new Date("2026-07-22T12:00:00.000Z"),
              bankReference: "REF-2026-063",
              amount: 100,
            },
          ],
        ],
      ])
    );
    const caller = appRouter.createCaller(createTreasuryContext("financiero"));
    const filters = { dateFrom: null, dateTo: null };

    const [
      all,
      pending,
      partial,
      paid,
      firstPage,
      secondPage,
      searchedByBatch,
    ] = await Promise.all([
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "all",
      }),
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "pending",
      }),
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "partial",
      }),
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "paid",
      }),
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "all",
        page: 1,
        pageSize: 2,
      }),
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "all",
        page: 2,
        pageSize: 2,
      }),
      caller.treasury.invoiceSummaryReport({
        ...filters,
        paymentStatus: "all",
        search: "TES-2026-000062",
      }),
    ]);

    expect(all.invoices.map(row => row["Documento interno"])).toEqual([
      "FT-00000061",
      "FT-00000062",
      "FT-00000063",
    ]);
    expect(pending.invoices.map(row => row["Documento interno"])).toEqual([
      "FT-00000061",
    ]);
    expect(pending.invoices.map(row => row.Estado)).toEqual(["Pendiente"]);
    expect(partial.invoices.map(row => row["Documento interno"])).toEqual([
      "FT-00000062",
    ]);
    expect(partial.invoices.map(row => row.Estado)).toEqual(["Parcial"]);
    expect(paid.invoices.map(row => row["Documento interno"])).toEqual([
      "FT-00000063",
    ]);
    expect(paid.invoices[0]?.Estado).toBe("Pagado");
    expect(paid.invoices[0]).toMatchObject({
      "Lote de pago": "TES-2026-000063",
      "Monto pagado": 100,
    });
    expect(firstPage.invoices).toHaveLength(2);
    expect(firstPage.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(secondPage.invoices.map(row => row["Documento interno"])).toEqual([
      "FT-00000063",
    ]);
    expect(
      searchedByBatch.invoices.map(row => row["Documento interno"])
    ).toEqual(["FT-00000062"]);
    expect(pageSpy).toHaveBeenCalledTimes(2);
    expect(invoiceSpy).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceIds: [61, 62] })
    );
    expect(invoiceSpy).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceIds: [63] })
    );
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
