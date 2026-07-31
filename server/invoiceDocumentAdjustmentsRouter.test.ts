import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import * as db from "./db";

function createContext(buildreqRole: "administracion_central" | "contable") {
  return {
    user: {
      id: buildreqRole === "contable" ? 31 : 30,
      openId: `test-${buildreqRole}`,
      email: `${buildreqRole}@example.com`,
      name: buildreqRole,
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

function detail(status: "borrador" | "rechazada" | "revisada" | "registrada") {
  return {
    invoice: { id: 10, projectId: 2, status },
    items: [],
    retentions: [],
    otherCharges: [],
    documentAdjustments: [],
  } as any;
}

const input = {
  id: 10,
  qualityRetentionPercent: 5,
  advanceAmortizationPercent: 10,
  promptPaymentPercent: 2,
  tcEnabled: true,
};

afterEach(() => vi.restoreAllMocks());

describe("invoice document adjustment endpoint", () => {
  it("allows invoice editors in draft and sends only percentages and activation", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(detail("borrador"));
    const replaceSpy = vi
      .spyOn(db, "replaceInvoiceDocumentAdjustments")
      .mockResolvedValue({
        invoice: { id: 10 },
        documentAdjustments: [],
      } as any);

    await appRouter
      .createCaller(createContext("administracion_central"))
      .invoices.replaceDocumentAdjustments(input);

    expect(replaceSpy).toHaveBeenCalledWith(10, {
      qualityRetentionPercent: 5,
      advanceAmortizationPercent: 10,
      promptPaymentPercent: 2,
      tcEnabled: true,
    });
  });

  it("allows accounting to edit a reviewed invoice", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(detail("revisada"));
    const replaceSpy = vi
      .spyOn(db, "replaceInvoiceDocumentAdjustments")
      .mockResolvedValue({
        invoice: { id: 10 },
        documentAdjustments: [],
      } as any);

    await appRouter
      .createCaller(createContext("contable"))
      .invoices.replaceDocumentAdjustments(input);

    expect(replaceSpy).toHaveBeenCalledOnce();
  });

  it("accepts amounts as the authoritative input for editable rows", async () => {
    vi.spyOn(db, "getInvoiceById").mockResolvedValue(detail("borrador"));
    const replaceSpy = vi
      .spyOn(db, "replaceInvoiceDocumentAdjustments")
      .mockResolvedValue({
        invoice: { id: 10 },
        documentAdjustments: [],
      } as any);

    await appRouter
      .createCaller(createContext("administracion_central"))
      .invoices.replaceDocumentAdjustments({
        ...input,
        qualityRetentionPercent: 0,
        qualityRetentionAmount: 1234.5678,
        advanceAmortizationPercent: 0,
        advanceAmortizationAmount: 500,
        promptPaymentPercent: 0,
        promptPaymentAmount: 25.5,
      });

    expect(replaceSpy).toHaveBeenCalledWith(10, {
      qualityRetentionPercent: 0,
      qualityRetentionAmount: 1234.5678,
      advanceAmortizationPercent: 0,
      advanceAmortizationAmount: 500,
      promptPaymentPercent: 0,
      promptPaymentAmount: 25.5,
      tcEnabled: true,
    });
  });

  it("blocks draft editors after review and blocks accounting before review", async () => {
    const getInvoiceSpy = vi.spyOn(db, "getInvoiceById");
    const replaceSpy = vi.spyOn(db, "replaceInvoiceDocumentAdjustments");

    getInvoiceSpy.mockResolvedValueOnce(detail("revisada"));
    await expect(
      appRouter
        .createCaller(createContext("administracion_central"))
        .invoices.replaceDocumentAdjustments(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    getInvoiceSpy.mockResolvedValueOnce(detail("borrador"));
    await expect(
      appRouter
        .createCaller(createContext("contable"))
        .invoices.replaceDocumentAdjustments(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("blocks accounted invoices and validates two-decimal percentages", async () => {
    const getInvoiceSpy = vi.spyOn(db, "getInvoiceById");
    const replaceSpy = vi.spyOn(db, "replaceInvoiceDocumentAdjustments");

    getInvoiceSpy.mockResolvedValueOnce(detail("registrada"));
    await expect(
      appRouter
        .createCaller(createContext("contable"))
        .invoices.replaceDocumentAdjustments(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      appRouter
        .createCaller(createContext("administracion_central"))
        .invoices.replaceDocumentAdjustments({
          ...input,
          qualityRetentionPercent: 1.234,
        })
    ).rejects.toThrow("dos decimales");
    await expect(
      appRouter
        .createCaller(createContext("administracion_central"))
        .invoices.replaceDocumentAdjustments({
          ...input,
          qualityRetentionPercent: 101,
        })
    ).rejects.toThrow();
    await expect(
      appRouter
        .createCaller(createContext("administracion_central"))
        .invoices.replaceDocumentAdjustments({
          ...input,
          qualityRetentionAmount: 1.23456,
        })
    ).rejects.toThrow("cuatro decimales");
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
