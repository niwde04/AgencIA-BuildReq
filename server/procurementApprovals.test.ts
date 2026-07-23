import { describe, expect, it } from "vitest";
import {
  formatApprovalSnapshotAmount,
  getPurchaseOrderApprovalReadinessError,
  isPurchaseOrderDraftLike,
  isPurchaseRequestConversionReady,
  canFinalizePurchaseRequestLineReview,
  PROCUREMENT_APPROVALS_ENABLED,
  purchaseOrderMeetsApprovalMinimum,
  purchaseOrderRequiresApproval,
  roundProcurementAmount,
  summarizePurchaseRequestApprovalItems,
  summarizePurchaseRequestLineDecisions,
} from "@shared/procurement-approvals";

describe("procurement approval limits", () => {
  const enabledSettings = {
    purchaseRequestApprovalsEnabled: false,
    purchaseOrderApprovalsEnabled: true,
    purchaseOrderApprovalMinimumHnl: 250_000,
    purchaseOrderApprovalMinimumUsd: 10_000,
  };

  it.each([
    ["HNL", 249_999.99, false],
    ["HNL", 250_000, true],
    ["HNL", 250_000.004, true],
    ["HNL", 250_000.01, true],
    ["USD", 9_999.99, false],
    ["USD", 10_000, true],
    ["USD", 10_000.004, true],
    ["USD", 10_000.01, true],
  ] as const)(
    "uses the inclusive configurable %s minimum for %s",
    (currency, total, expected) => {
      expect(
        purchaseOrderMeetsApprovalMinimum(currency, total, enabledSettings)
      ).toBe(expected);
    }
  );

  it("uses independent amounts per currency", () => {
    const customSettings = {
      ...enabledSettings,
      purchaseOrderApprovalMinimumHnl: 125_000,
      purchaseOrderApprovalMinimumUsd: 5_500,
    };
    expect(purchaseOrderRequiresApproval("HNL", 125_000, customSettings)).toBe(
      true
    );
    expect(purchaseOrderRequiresApproval("USD", 5_499.99, customSettings)).toBe(
      false
    );
  });

  it("bypasses monetary approval while the switch is disabled", () => {
    expect(PROCUREMENT_APPROVALS_ENABLED).toBe(false);
    const disabledSettings = {
      ...enabledSettings,
      purchaseOrderApprovalsEnabled: false,
    };
    expect(
      purchaseOrderMeetsApprovalMinimum("HNL", 300_000, disabledSettings)
    ).toBe(true);
    expect(
      purchaseOrderRequiresApproval("HNL", 300_000, disabledSettings)
    ).toBe(false);
    expect(purchaseOrderRequiresApproval("USD", 12_000, disabledSettings)).toBe(
      false
    );
  });

  it("accepts zero as a minimum amount", () => {
    const zeroSettings = {
      ...enabledSettings,
      purchaseOrderApprovalMinimumHnl: 0,
      purchaseOrderApprovalMinimumUsd: 0,
    };
    expect(purchaseOrderRequiresApproval("HNL", 0, zeroSettings)).toBe(true);
    expect(purchaseOrderRequiresApproval("USD", 1, zeroSettings)).toBe(true);
  });

  it("allows open procurement documents to continue while disabled", () => {
    expect(isPurchaseRequestConversionReady("pendiente", null)).toBe(true);
    expect(isPurchaseRequestConversionReady("en_revision", "pendiente")).toBe(
      true
    );
    expect(
      isPurchaseRequestConversionReady("parcialmente_convertida", "no_requiere")
    ).toBe(true);
    expect(isPurchaseOrderDraftLike("borrador", null)).toBe(true);
    expect(isPurchaseOrderDraftLike("pendiente_aprobacion", "pendiente")).toBe(
      true
    );
    expect(isPurchaseOrderDraftLike("rechazada", "rechazada")).toBe(true);
    expect(isPurchaseOrderDraftLike("aprobada", "aprobada")).toBe(false);
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

describe("purchase request line approval", () => {
  it("summarizes a partially approved request from its item statuses", () => {
    expect(
      summarizePurchaseRequestApprovalItems([
        { approvalStatus: "aprobada" },
        { approvalStatus: "rechazada" },
        { approvalStatus: "descartada" },
        { approvalStatus: "pendiente" },
        { approvalStatus: "no_requiere" },
      ])
    ).toEqual({
      totalItemCount: 5,
      approvedItemCount: 1,
      rejectedItemCount: 1,
      discardedItemCount: 1,
      pendingItemCount: 1,
      noApprovalRequiredItemCount: 1,
      isPartiallyApproved: true,
    });
  });

  it("requires an explicit decision for every pending line", () => {
    expect(summarizePurchaseRequestLineDecisions([10, 20], {})).toEqual({
      approvedItemIds: [],
      rejectedItemIds: [],
      undecidedItemIds: [10, 20],
      isComplete: false,
    });
    expect(
      canFinalizePurchaseRequestLineReview({
        pendingItemIds: [10, 20],
        decisions: { 10: "approve", 20: "reject" },
        rejectionComment: "No cumple la especificación",
        approvedQuantitiesValid: true,
      })
    ).toBe(true);
  });

  it("allows a complete approval without a rejection note", () => {
    expect(
      canFinalizePurchaseRequestLineReview({
        pendingItemIds: [10, 20],
        decisions: { 10: "approve", 20: "approve" },
        approvedQuantitiesValid: true,
      })
    ).toBe(true);
    expect(
      canFinalizePurchaseRequestLineReview({
        pendingItemIds: [10, 20],
        decisions: { 10: "approve", 20: "approve" },
        approvedQuantitiesValid: false,
      })
    ).toBe(false);
  });

  it("requires a shared reason whenever at least one line is rejected", () => {
    expect(
      canFinalizePurchaseRequestLineReview({
        pendingItemIds: [10, 20],
        decisions: { 10: "approve", 20: "reject" },
        rejectionComment: "No",
        approvedQuantitiesValid: true,
      })
    ).toBe(false);
    expect(
      canFinalizePurchaseRequestLineReview({
        pendingItemIds: [10],
        decisions: { 10: "reject" },
        rejectionComment: "x".repeat(1001),
        approvedQuantitiesValid: true,
      })
    ).toBe(false);
    expect(
      canFinalizePurchaseRequestLineReview({
        pendingItemIds: [10, 20],
        decisions: { 10: "reject", 20: "reject" },
        rejectionComment: "Compra no autorizada",
        approvedQuantitiesValid: true,
      })
    ).toBe(true);
  });
});
