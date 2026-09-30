import { describe, expect, it } from "vitest";
import {
  proposeContractualAmortization,
  contractualAmortizationAmount,
} from "../shared/contractual-advances";
import { buildTreasuryMoneySummary } from "../shared/treasury";
describe("contractual advance rules", () => {
  it("deducts the GEO amortization once and keeps it outside direct settlement", () => {
    expect(
      proposeContractualAmortization({
        amortizationMode: "percentage",
        amortizationValue: 25,
        amortizationBase: "subtotal",
        subtotal: 2061372.47,
        total: 2061372.47,
        remainingAmount: 1163051.75,
      }).amount
    ).toBe(515343.12);
    expect(
      buildTreasuryMoneySummary({
        currency: "HNL",
        invoiceNetPayable: 1442960.73,
        contractualAmortizationAmount: 515343.12,
      }).availableAmount
    ).toBe(1442960.73);
  });
  it.each([
    ["subtotal", 100],
    ["total", 115],
  ] as const)("uses the selected %s base", (base, expected) => {
    expect(
      proposeContractualAmortization({
        amortizationMode: "percentage",
        amortizationValue: 10,
        amortizationBase: base,
        subtotal: 1000,
        total: 1150,
        remainingAmount: 1000,
      }).amount
    ).toBe(expected);
  });
  it("caps a proposal to the remaining advance and accepts a justified zero", () => {
    expect(
      proposeContractualAmortization({
        amortizationMode: "amount",
        amortizationValue: 100,
        amortizationBase: "subtotal",
        subtotal: 1000,
        total: 1150,
        remainingAmount: 33.01,
      }).amount
    ).toBe(33.01);
    expect(
      contractualAmortizationAmount({
        baseAmount: 1000,
        inputMode: "amount",
        inputValue: 0,
        remainingAmount: 100,
        proposedAmount: 100,
        overrideReason: "No amortizar esta planilla",
      })
    ).toBe(0);
  });
  it("rejects overrides without explanation and amounts above available", () => {
    expect(() =>
      contractualAmortizationAmount({
        baseAmount: 1000,
        inputMode: "amount",
        inputValue: 0,
        remainingAmount: 100,
        proposedAmount: 100,
      })
    ).toThrow(/motivo/);
    expect(() =>
      contractualAmortizationAmount({
        baseAmount: 1000,
        inputMode: "amount",
        inputValue: 100.01,
        remainingAmount: 100,
        proposedAmount: 100,
        overrideReason: "Ajuste registrado",
      })
    ).toThrow(/supera/);
  });
});
