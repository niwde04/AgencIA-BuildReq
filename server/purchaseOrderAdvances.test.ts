import { describe, expect, it } from "vitest";
import {
  buildPurchaseOrderAdvanceMoneySummary,
  buildPurchaseOrderAdvancesSummary,
} from "./purchaseOrderAdvances";
import {
  allowsPurchaseOrderAdvance,
  formatPurchaseOrderPaymentMethodPrintLabel,
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
