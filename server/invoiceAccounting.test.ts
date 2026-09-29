import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invoiceAccountingBalance,
  summarizeInvoiceTaxes,
  summarizeInvoiceRetentions,
} from "../shared/invoice-accounting";
import { appRouter } from "./routers";
import * as db from "./db";
import * as queue from "./invoiceAccounting";
import * as treasury from "./treasury";
import type { TrpcContext } from "./_core/context";
const context = (role = "contable") =>
  ({
    user: {
      id: 1,
      role: "user",
      buildreqRole: role,
      assignedProjectId: role === "administrador_proyecto" ? 17 : null,
      assignedProjectIds: role === "administrador_proyecto" ? [17] : [],
    },
    req: { headers: {} },
    res: {},
  }) as TrpcContext;
const detail = (status = "revisada") =>
  ({
    invoice: { id: 1, projectId: 1, status },
    items: [],
    retentions: [],
  }) as any;
afterEach(() => vi.restoreAllMocks());
describe("invoice accounting queue", () => {
  it("sends a reviewed invoice without calling accounting", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(detail());
    const send = vi
      .spyOn(db, "submitInvoiceForAccounting")
      .mockResolvedValue({ id: 1, status: "pendiente_contabilizar" } as any);
    const account = vi.spyOn(db, "accountInvoice");
    await appRouter
      .createCaller(context())
      .invoices.submitForAccounting({ id: 1, accountingComment: "Revisada" });
    expect(send).toHaveBeenCalledWith({
      id: 1,
      submittedById: 1,
      accountingComment: "Revisada",
    });
    expect(account).not.toHaveBeenCalled();
  });
  it.each([
    "borrador",
    "rechazada",
    "registrada",
    "anulada",
    "pendiente_contabilizar",
  ])("rejects sending status %s", async status => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(detail(status));
    const send = vi.spyOn(db, "submitInvoiceForAccounting");
    await expect(
      appRouter.createCaller(context()).invoices.submitForAccounting({ id: 1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["administrador_proyecto", "administracion_central", "financiero"])(
    "keeps accounting actions restricted for %s",
    async role => {
      const caller = appRouter.createCaller(context(role));
      for (const request of [
        () => caller.invoices.submitForAccounting({ id: 1 }),
        () => caller.invoices.account({ id: 1 }),
        () => caller.invoices.reject({ id: 1, rejectionComment: "Corregir" }),
      ])
        await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
  it.each(["account", "reject"] as const)(
    "does not allow %s before submission",
    async action => {
      vi.spyOn(db, "getInvoiceById").mockResolvedValue(detail());
      const caller = appRouter.createCaller(context());
      await expect(
        action === "account"
          ? caller.invoices.account({ id: 1 })
          : caller.invoices.reject({ id: 1, rejectionComment: "Corregir" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  );
  it("requires a rejection reason", async () => {
    await expect(
      appRouter
        .createCaller(context())
        .invoices.reject({ id: 1, rejectionComment: " " })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("defaults the queue to pending and applies currency, dates, search and project scope", async () => {
    vi.spyOn(treasury, "getTreasurySettings").mockResolvedValue({
      treasuryEnabled: true,
    } as any);
    const list = vi
      .spyOn(queue, "listInvoiceAccountingQueue")
      .mockResolvedValue({
        items: [],
        total: 0,
        totalPages: 1,
        page: 1,
        pageSize: 10,
      });
    await appRouter
      .createCaller(context("administrador_proyecto"))
      .treasury.invoiceAccountingQueue({
        currency: "USD",
        search: "OC-01",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        page: 2,
      });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "USD",
        status: "pendiente_contabilizar",
        projectIds: [17],
        search: "OC-01",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        page: 2,
      })
    );
    await expect(
      appRouter
        .createCaller(context("administrador_proyecto"))
        .treasury.invoiceAccountingQueue({ projectId: 99 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(list).toHaveBeenCalledTimes(1);
  });
  it("blocks invalid dates and disabled Treasury", async () => {
    const settings = vi
      .spyOn(treasury, "getTreasurySettings")
      .mockResolvedValue({ treasuryEnabled: true } as any);
    await expect(
      appRouter
        .createCaller(context())
        .treasury.invoiceAccountingQueue({
          dateFrom: "2026-12-01",
          dateTo: "2026-01-01",
        })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    settings.mockResolvedValue({ treasuryEnabled: false } as any);
    await expect(
      appRouter.createCaller(context()).treasury.invoiceAccountingQueue({})
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("passes the currency filter to both existing invoice reports", async () => {
    vi.spyOn(treasury, "getTreasurySettings").mockResolvedValue({
      treasuryEnabled: true,
    } as any);
    const source = vi
      .spyOn(db, "listDmcReportSourceInvoices")
      .mockResolvedValue([]);
    vi.spyOn(treasury, "getTreasuryInvoiceReportPayments").mockResolvedValue(
      new Map()
    );
    const caller = appRouter.createCaller(context());
    await caller.reports.systemInvoices({ currency: "USD" });
    expect(source).toHaveBeenLastCalledWith(
      expect.objectContaining({ currency: "USD" })
    );
    await caller.treasury.invoiceSummaryReport({
      currency: "HNL",
      paymentStatus: "all",
    });
    expect(source).toHaveBeenLastCalledWith(
      expect.objectContaining({ currency: "HNL" })
    );
  });
  it("groups snapshots and reconciles a document exemption without recalculating taxes", () => {
    const tax = {
      taxCode: "isv_15",
      label: "ISV 15%",
      shortLabel: "ISV",
      taxType: "base" as const,
      fiscalCategory: "gravado" as const,
      ratePercent: 15,
      rate: 0.15,
      baseAmount: 100,
      amount: 15,
      displayOrder: 1,
    };
    const items = [
      { taxCode: "isv_15", taxAmount: 15, taxBreakdown: [tax] },
      { taxCode: "isv_15", taxAmount: 15, taxBreakdown: [tax] },
      { taxCode: "turismo", taxAmount: 4, taxBreakdown: [] },
    ];
    const result = summarizeInvoiceTaxes(items, 19);
    expect(result.map(row => row.amount)).toEqual([30, 4, -15]);
    expect(result.reduce((sum, row) => sum + row.amount, 0)).toBe(19);
    expect(summarizeInvoiceTaxes([], 8)[0].amount).toBe(8);
  });
  it("separates all requested withholding rates and includes document retentions once", () => {
    expect(
      summarizeInvoiceRetentions(
        [
          { percentage: 1, amount: 10 },
          { percentage: 1, amount: 5 },
          { percentage: 10, amount: 100 },
          { percentage: 12.5, amount: 125 },
          { percentage: 15, amount: 150 },
          { percentage: 25, amount: 250 },
          { percentage: 3, amount: 30 },
        ],
        670,
        20
      )
    ).toEqual({
      one: 15,
      ten: 100,
      services: 125,
      fifteen: 150,
      twentyFive: 250,
      other: 50,
    });
  });
  it("uses the saved net and subtracts actual advances and payments only once", () => {
    expect(invoiceAccountingBalance(700, 200, 150)).toBe(350);
    expect(invoiceAccountingBalance(50, 100, 0)).toBe(0);
    expect(invoiceAccountingBalance(1.0001, 0.1, 0.2)).toBe(0.7001);
  });
});
