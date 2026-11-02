import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import * as db from "./db";
import { purchaseOrdersRouter } from "./routers/purchaseOrders";
import {
  billingToday,
  billingDate,
  billingMoneyUnits,
  billingMoneyString,
  canAuthorizePurchaseOrderBilling,
  getContractBillingDecision,
  type PurchaseOrderBillingAuthorization,
} from "../shared/purchase-order-billing";
import {
  grantPurchaseOrderBilling,
  assertBillingManager,
  purchaseOrderBillingReady,
} from "./purchaseOrderBilling";
const now = new Date("2026-11-02T18:00:00Z");
const authorization: PurchaseOrderBillingAuthorization = {
  id: 5,
  purchaseOrderId: 1,
  authorizedUntil: "2026-12-31",
  originalExpectedInvoiceCount: 2,
  additionalInvoiceCount: 1,
  maxInvoiceCount: 3,
  maxAmount: "1000.0000",
  usedAmount: "400.0000",
  remainingAmount: "600.0000",
  reason: "Continuidad autorizada de obra",
  supportAttachmentId: 3,
  supportFileName: "autorizacion.pdf",
  authorizedById: 1,
  authorizedByName: "Central",
  authorizedAt: "2026-11-02T12:00:00Z",
  revokedAt: null,
  revokedById: null,
  revokeReason: null,
  isUsable: true,
};
const summary = {
  expectedInvoiceCount: 2,
  registeredInvoiceCount: 1,
  isExpired: true,
  billingAuthorization: null as PurchaseOrderBillingAuthorization | null,
};
const decide = (
  overrides: Partial<Parameters<typeof getContractBillingDecision>[0]> = {}
) =>
  getContractBillingDecision({
    contractSummary: summary,
    contractEndDate: "2026-10-31",
    documentDate: "2026-10-31",
    now,
    ...overrides,
  });
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("contractual billing authorization decisions", () => {
  it("preserves historical invoices inside original date and count without authorization", () =>
    expect(decide()).toMatchObject({
      allowed: true,
      requiresAuthorization: false,
      authorizationId: null,
    }));
  it("rejects late invoices without authorization", () =>
    expect(decide({ documentDate: "2026-11-01" })).toMatchObject({
      allowed: false,
      requiresAuthorization: true,
    }));
  it("accepts an authorized late invoice without changing the original expected count", () => {
    const value = { ...summary, billingAuthorization: authorization };
    expect(
      decide({ contractSummary: value, documentDate: "2026-11-02" })
    ).toMatchObject({
      allowed: true,
      requiresAuthorization: true,
      authorizationId: 5,
    });
    expect(value.expectedInvoiceCount).toBe(2);
  });
  it("requires an authorization when the original count has been exhausted even with an old document", () => {
    expect(
      decide({ contractSummary: { ...summary, registeredInvoiceCount: 2 } })
        .allowed
    ).toBe(false);
    expect(
      decide({
        contractSummary: {
          ...summary,
          registeredInvoiceCount: 2,
          billingAuthorization: authorization,
        },
      }).allowed
    ).toBe(true);
  });
  it("blocks both a consumed authorization and a date later than its limit", () => {
    expect(
      decide({
        contractSummary: {
          ...summary,
          registeredInvoiceCount: 3,
          billingAuthorization: authorization,
        },
      }).allowed
    ).toBe(false);
    expect(
      decide({
        contractSummary: { ...summary, billingAuthorization: authorization },
        documentDate: "2027-01-01",
      }).allowed
    ).toBe(false);
  });
  it.each([
    { ...authorization, revokedAt: now.toISOString() },
    { ...authorization, isUsable: false },
    { ...authorization, authorizedUntil: "2026-11-01" },
  ])("blocks revoked or expired permissions", auth =>
    expect(
      decide({
        contractSummary: { ...summary, billingAuthorization: auth },
        documentDate: "2026-11-02",
      }).allowed
    ).toBe(false)
  );
  it("requires the real document date for exceptions", () =>
    expect(
      decide({
        documentDate: undefined,
        contractSummary: { ...summary, billingAuthorization: authorization },
      }).allowed
    ).toBe(false));
  it("checks money exactly and accepts the last authorized ten-thousandth", () => {
    const contractSummary = { ...summary, billingAuthorization: authorization };
    expect(
      decide({
        contractSummary,
        documentDate: "2026-11-02",
        receiptAmount: "600.0000",
      }).allowed
    ).toBe(true);
    expect(
      decide({
        contractSummary,
        documentDate: "2026-11-02",
        receiptAmount: "600.0001",
      }).allowed
    ).toBe(false);
    expect(billingMoneyString(billingMoneyUnits("99999999999999.9999"))).toBe(
      "99999999999999.9999"
    );
  });
  it("uses the Honduras day at UTC midnight", () =>
    expect(billingToday(new Date("2026-11-03T02:00:00Z"))).toBe("2026-11-02"));
  it("rejects invalid dates and amounts", () => {
    expect(billingDate("2026-02-30")).toBe(null);
    expect(decide({ documentDate: "bad" }).allowed).toBe(false);
    expect(() => billingMoneyUnits("-1")).toThrow();
    expect(() => billingMoneyUnits("1.00001")).toThrow();
  });
});
describe("billing authorization access boundaries", () => {
  it.each([
    null,
    { role: "user", buildreqRole: "administrador_proyecto" },
    { role: "user", buildreqRole: "bodeguero_proyecto" },
    { role: "admin", buildreqRole: "gerente" },
    { role: "admin", buildreqRole: "superintendente_aprobador" },
  ])("denies non central callers including approval-only admins", user =>
    expect(canAuthorizePurchaseOrderBilling(user)).toBe(false)
  );
  it("allows Central and the technical administrator", () => {
    expect(
      canAuthorizePurchaseOrderBilling({
        role: "user",
        buildreqRole: "administracion_central",
      })
    ).toBe(true);
    expect(canAuthorizePurchaseOrderBilling({ role: "admin" })).toBe(true);
  });
  it("rejects before reading resources for disallowed callers", async () => {
    const execute = vi.fn();
    await expect(
      grantPurchaseOrderBilling(
        { execute, insert: vi.fn(), update: vi.fn() },
        { id: 1, role: "user", buildreqRole: "administrador_proyecto" },
        {
          id: 999,
          authorizedUntil: "2026-12-31",
          additionalInvoiceCount: 1,
          reason: "Autorización de prueba",
          supportAttachmentId: 1,
        }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["borrador", "pendiente_aprobacion", "anulada"])(
    "does not authorize unissued orders (%s)",
    status =>
      expect(() =>
        assertBillingManager(
          { id: 1, role: "admin" },
          { projectId: 1, appliesContract: true, status }
        )
      ).toThrow()
  );
  it("does not grant contractual exceptions to ordinary purchase orders", () =>
    expect(() =>
      assertBillingManager(
        { id: 1, role: "admin" },
        { projectId: 1, appliesContract: false, status: "emitida" }
      )
    ).toThrow());
  it("reports missing schema explicitly and propagates actual query failures", async () => {
    expect(
      await purchaseOrderBillingReady({
        execute: vi.fn().mockResolvedValue({ rows: [{ ready: false }] }),
        insert: null,
        update: null,
      })
    ).toBe(false);
    await expect(
      purchaseOrderBillingReady({
        execute: vi.fn().mockRejectedValue(new Error("network failed")),
        insert: null,
        update: null,
      })
    ).rejects.toThrow("network failed");
  });
});

describe("billing authorization history API scope", () => {
  const call = (user: Record<string, unknown> | null) =>
    purchaseOrdersRouter.createCaller({
      user: user
        ? {
            id: 1,
            role: "user",
            buildreqRole: "administracion_central",
            ...user,
          }
        : null,
      req: { headers: {} },
      res: {},
    } as any);
  beforeEach(() => {
    vi.spyOn(db, "getProcurementApprovalSettings").mockResolvedValue({} as any);
    vi.spyOn(db, "getPurchaseOrderById").mockResolvedValue({
      purchaseOrder: {
        id: 1,
        projectId: 1,
        status: "recibida",
        appliesContract: true,
      },
    } as any);
    vi.spyOn(db, "getPurchaseOrderBillingAuthorization").mockResolvedValue({
      ready: true,
      active: authorization,
      history: [authorization],
    });
  });
  it("does not expose history to an unauthenticated caller", async () => {
    await expect(
      call(null).billingAuthorization({ id: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.getPurchaseOrderBillingAuthorization).not.toHaveBeenCalled();
  });
  it("does not expose another project's history", async () => {
    await expect(
      call({
        buildreqRole: "administrador_proyecto",
        assignedProjectId: 2,
      }).billingAuthorization({ id: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getPurchaseOrderBillingAuthorization).not.toHaveBeenCalled();
  });
  it("preserves approval-only visibility even with the base admin role", async () => {
    await expect(
      call({
        role: "admin",
        buildreqRole: "gerente",
        assignedProjectId: 1,
      }).billingAuthorization({ id: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getPurchaseOrderBillingAuthorization).not.toHaveBeenCalled();
  });
  it("lets Central manage and the owning project's staff only read", async () => {
    expect((await call({}).billingAuthorization({ id: 1 })).canAuthorize).toBe(
      true
    );
    expect(
      (
        await call({
          buildreqRole: "administrador_proyecto",
          assignedProjectId: 1,
        }).billingAuthorization({ id: 1 })
      ).canAuthorize
    ).toBe(false);
  });
});
