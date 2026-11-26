import { describe, expect, it } from "vitest";
import {
  getTreasuryPaymentTotals,
  resolveTreasuryPaymentReportAmount,
} from "./treasury";

const registeredLines = [
  { status: "pagada", bankPaidAmount: "1575.5000" },
  { status: "pagada", bankPaidAmount: "2499.0000" },
  { status: "pagada", bankPaidAmount: "14156.9900" },
];

describe("effective bank payment totals", () => {
  it("subtracts only the reverted advance from a partial batch", () => {
    const lines = [
      ...registeredLines.slice(0, 2),
      { ...registeredLines[2], status: "revertida" },
    ];
    expect(getTreasuryPaymentTotals(lines)).toEqual({
      originalBankPaidTotal: 18231.49,
      reversedBankPaidTotal: 14156.99,
      effectiveBankPaidTotal: 4074.5,
    });
  });

  it("retains the original total when the batch has no active payments", () => {
    expect(
      getTreasuryPaymentTotals(
        registeredLines.map(line => ({ ...line, status: "revertida" }))
      )
    ).toEqual({
      originalBankPaidTotal: 18231.49,
      reversedBankPaidTotal: 18231.49,
      effectiveBankPaidTotal: 0,
    });
  });

  it("rounds historical amounts to cents before adding them", () => {
    expect(
      getTreasuryPaymentTotals([
        { status: "revertida", bankPaidAmount: "0.0050" },
        { status: "pagada", bankPaidAmount: "0.0050" },
        { status: "excluida", bankPaidAmount: "1000.0000" },
      ])
    ).toEqual({
      originalBankPaidTotal: 0.02,
      reversedBankPaidTotal: 0.01,
      effectiveBankPaidTotal: 0.01,
    });
  });

  it("leaves no active payment when a rejected discrepancy has a historical bank amount", () => {
    const lines = [
      {
        status: "rechazada_banco",
        sourceType: "purchase_order_advance",
        bankPaidAmount: "25.00",
      },
      {
        status: "revertida",
        sourceType: "purchase_order_advance",
        bankPaidAmount: "100.00",
      },
    ];
    expect(getTreasuryPaymentTotals(lines)).toEqual({
      originalBankPaidTotal: 100,
      reversedBankPaidTotal: 100,
      effectiveBankPaidTotal: 0,
    });
  });

  it("reports zero for a reverted line even with historical or approved amounts", () => {
    expect(
      resolveTreasuryPaymentReportAmount({
        ...registeredLines[2],
        status: "revertida",
        approvedAmount: 14156.99,
      })
    ).toBe(0);
    expect(
      resolveTreasuryPaymentReportAmount({
        status: "revertida",
        bankPaidAmount: null,
        approvedAmount: 14156.99,
      })
    ).toBe(0);
  });
});
