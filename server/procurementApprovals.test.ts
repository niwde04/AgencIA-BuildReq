import { describe, expect, it } from "vitest";
import {
  formatApprovalSnapshotAmount,
  getPurchaseOrderApprovalReadinessError,
  purchaseOrderRequiresApproval,
  roundProcurementAmount,
} from "@shared/procurement-approvals";

describe("procurement approval limits", () => {
  it.each([
    ["HNL", 250_000, false],
    ["HNL", 250_000.004, false],
    ["HNL", 250_000.005, true],
    ["HNL", 250_000.01, true],
    ["USD", 10_000, false],
    ["USD", 10_000.004, false],
    ["USD", 10_000.005, true],
    ["USD", 10_000.01, true],
  ] as const)("uses the strict %s limit for %s", (currency, total, expected) => {
    expect(purchaseOrderRequiresApproval(currency, total)).toBe(expected);
  });

  it("normalizes approval snapshots to cents", () => {
    expect(roundProcurementAmount(123.456)).toBe(123.46);
    expect(formatApprovalSnapshotAmount("123.456")).toBe("123.46");
    expect(formatApprovalSnapshotAmount(undefined)).toBe("0.00");
  });

  it("requires a payment method for every CD classification", () => {
    expect(
      getPurchaseOrderApprovalReadinessError({
        supplierId: 7,
        classification: "cd",
        purchaseType: "local",
        currency: "HNL",
        appliesContract: false,
        items: [{ unitPrice: "100.00", subtotal: "100.00" }],
      })
    ).toBe("Seleccione el método de pago para la orden de compra");
  });

  it("validates USD rate, contract schedule, and positive line amounts", () => {
    const base = {
      supplierId: 7,
      classification: "oc",
      purchaseType: "local",
      currency: "USD",
      exchangeRate: "25.50000000",
      exchangeRateDate: new Date("2026-07-14T12:00:00Z"),
      appliesContract: true,
      contractPaymentFrequency: "mensual",
      contractFirstPaymentDate: new Date("2026-07-15T12:00:00Z"),
      contractEndDate: new Date("2026-12-15T12:00:00Z"),
      items: [{ unitPrice: "100.00", subtotal: "100.00" }],
    };

    expect(getPurchaseOrderApprovalReadinessError(base)).toBeNull();
    expect(
      getPurchaseOrderApprovalReadinessError({
        ...base,
        exchangeRate: null,
      })
    ).toBe(
      "Ingrese una tasa referencial válida, positiva y con máximo 8 decimales"
    );
    expect(
      getPurchaseOrderApprovalReadinessError({
        ...base,
        contractEndDate: null,
      })
    ).toBe("Complete todos los datos del contrato antes de continuar");
    expect(
      getPurchaseOrderApprovalReadinessError({
        ...base,
        items: [{ unitPrice: "0.00", subtotal: "0.00" }],
      })
    ).toBe(
      "Ingrese precio unitario y subtotal mayores que cero antes de emitir la OC"
    );
  });
});
