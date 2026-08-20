import { describe, expect, it } from "vitest";
import {
  buildPurchaseOrderAdvanceMoneySummary,
  buildPurchaseOrderAdvancesSummary,
  resolvePurchaseOrderOfficialTotal,
} from "./purchaseOrderAdvances";
import {
  allowsPurchaseOrderAdvance,
  calculatePurchaseOrderAdvanceAvailableAmount,
  formatPurchaseOrderCurrency,
  formatPurchaseOrderPaymentMethodPrintLabel,
  formatPurchaseOrderUnitPrice,
  getPurchaseOrderFiscalSummaryRows,
  roundPurchaseOrderDisplayMoney,
  summarizePurchaseOrderLines,
} from "../shared/purchase-orders";

describe("purchase order advance balances", () => {
  it("allows advances only for purchase orders paid cash", () => {
    expect(allowsPurchaseOrderAdvance("contado")).toBe(true);
    expect(allowsPurchaseOrderAdvance("linea_credito")).toBe(false);
    expect(allowsPurchaseOrderAdvance("fondo_proyecto")).toBe(false);
    expect(allowsPurchaseOrderAdvance(null)).toBe(false);
  });

  it("prints the new cash payment method explicitly", () => {
    expect(formatPurchaseOrderPaymentMethodPrintLabel("contado")).toBe(
      "CONTADO"
    );
  });

  it("uses the exact printed purchase-order total as the advance limit", () => {
    const calculatedTotal = 46_280.3355;

    expect(roundPurchaseOrderDisplayMoney(calculatedTotal)).toBe(46_280.34);
    expect(formatPurchaseOrderCurrency(calculatedTotal, "HNL")).toBe(
      "L 46,280.34"
    );
    expect(
      calculatePurchaseOrderAdvanceAvailableAmount(calculatedTotal, 0)
    ).toBe(46_280.34);
    expect(
      calculatePurchaseOrderAdvanceAvailableAmount(calculatedTotal, 46_280.33)
    ).toBe(0.01);
  });

  it("uses the immutable sealed total instead of recalculating an issued order", () => {
    expect(
      resolvePurchaseOrderOfficialTotal({
        sealedTotal: "46280.34",
        calculatedTotal: "46280.3355",
      })
    ).toBe(46_280.34);
    expect(
      resolvePurchaseOrderOfficialTotal({
        sealedTotal: "9847.34",
        calculatedTotal: "9847.3350",
      })
    ).toBe(9_847.34);
  });

  it("prints enough unit-price precision to reconcile the purchase-order line", () => {
    expect(formatPurchaseOrderUnitPrice("100.60942500")).toBe("100.609425");
    expect(
      roundPurchaseOrderDisplayMoney(
        400 * Number(formatPurchaseOrderUnitPrice("100.60942500"))
      )
    ).toBe(40_243.77);
  });

  it("shows an explicit rounding adjustment when displayed components need it", () => {
    const summary = summarizePurchaseOrderLines([
      {
        quantity: 1,
        unitPrice: "103998.2465",
        subtotal: "103998.2465",
        taxCode: "isv_15",
      },
    ]);
    const rows = getPurchaseOrderFiscalSummaryRows(summary);

    expect(rows.find(row => row.key === "subtotal")?.value).toBe(103_998.25);
    expect(rows.find(row => row.key === "isv-isv_15")?.value).toBe(15_599.74);
    expect(rows.find(row => row.key === "rounding-adjustment")?.value).toBe(
      -0.01
    );
    expect(rows.find(row => row.key === "total")?.value).toBe(119_597.98);
  });

  it("keeps requested, reserved, accounted and applied amounts separate", () => {
    expect(
      buildPurchaseOrderAdvanceMoneySummary({
        requestedAmount: 1000,
        accountedAmount: 400,
        reservedAmount: 250,
        appliedAmount: 150,
      })
    ).toEqual({
      requestedAmount: 1000,
      accountedAmount: 400,
      reservedAmount: 250,
      bankPaidPendingAmount: 0,
      appliedAmount: 150,
      availableToPayAmount: 350,
      unappliedAmount: 250,
      status: "en_lote",
    });
  });

  it("reports bank-paid funds as unavailable until accounting", () => {
    expect(
      buildPurchaseOrderAdvanceMoneySummary({
        requestedAmount: 500,
        bankPaidPendingAmount: 500,
        reservedAmount: 500,
      })
    ).toMatchObject({
      availableToPayAmount: 0,
      accountedAmount: 0,
      unappliedAmount: 0,
      status: "pagado_pendiente_contabilizacion",
    });
  });

  it("never applies more than the accounted amount", () => {
    expect(
      buildPurchaseOrderAdvanceMoneySummary({
        requestedAmount: 800,
        accountedAmount: 300,
        appliedAmount: 450,
      })
    ).toMatchObject({
      appliedAmount: 300,
      unappliedAmount: 0,
      status: "parcialmente_contabilizado",
    });
  });

  it("marks a fully accounted and consumed advance as applied", () => {
    expect(
      buildPurchaseOrderAdvanceMoneySummary({
        requestedAmount: 800,
        accountedAmount: 800,
        appliedAmount: 800,
      })
    ).toMatchObject({
      availableToPayAmount: 0,
      unappliedAmount: 0,
      status: "aplicado",
    });
  });

  it("summarizes every active advance related to the purchase order", () => {
    expect(
      buildPurchaseOrderAdvancesSummary([
        buildPurchaseOrderAdvanceMoneySummary({
          requestedAmount: 700,
          accountedAmount: 400,
          appliedAmount: 150,
        }),
        buildPurchaseOrderAdvanceMoneySummary({
          requestedAmount: 300,
          reservedAmount: 300,
        }),
      ])
    ).toEqual({
      count: 2,
      requestedAmount: 1000,
      accountedAmount: 400,
      reservedAmount: 300,
      bankPaidPendingAmount: 0,
      appliedAmount: 150,
      availableToPayAmount: 300,
      unappliedAmount: 250,
    });
  });
});
