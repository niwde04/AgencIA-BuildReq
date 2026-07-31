import { describe, expect, it } from "vitest";
import {
  calculateInvoiceDocumentAdjustments,
  calculateInvoiceNetPayable,
  getInvoiceBaseIsvAmount,
} from "../shared/invoice-document-adjustments";

describe("invoice document adjustments", () => {
  it("calculates the four document adjustments from canonical bases", () => {
    const result = calculateInvoiceDocumentAdjustments({
      subtotal: 1000,
      baseIsvAmount: 150,
      input: {
        qualityRetentionPercent: 5,
        advanceAmortizationPercent: 10,
        promptPaymentPercent: 2,
        tcEnabled: true,
      },
    });

    expect(result.calculations).toEqual([
      {
        adjustmentType: "quality_retention",
        inputMode: "percentage",
        percentage: 5,
        baseAmount: 1000,
        amount: 50,
      },
      {
        adjustmentType: "advance_amortization",
        inputMode: "percentage",
        percentage: 10,
        baseAmount: 1000,
        amount: 100,
      },
      {
        adjustmentType: "prompt_payment_discount",
        inputMode: "percentage",
        percentage: 2,
        baseAmount: 1000,
        amount: 20,
      },
      {
        adjustmentType: "tc_discount",
        inputMode: "percentage",
        percentage: 8,
        baseAmount: 150,
        amount: 12,
      },
    ]);
    expect(result.otherRetentionTotal).toBe(150);
    expect(result.documentDiscountTotal).toBe(32);
    expect(
      calculateInvoiceNetPayable({
        total: 1150,
        otherRetentionTotal: result.otherRetentionTotal,
        documentDiscountTotal: result.documentDiscountTotal,
      })
    ).toBe(968);
    expect(
      calculateInvoiceNetPayable({
        total: 1150,
        fiscalRetentionTotal: 100,
        otherRetentionTotal: result.otherRetentionTotal,
        documentDiscountTotal: result.documentDiscountTotal,
      })
    ).toBe(868);
  });

  it("uses only base taxable ISV and excludes additional taxes", () => {
    const baseIsv = getInvoiceBaseIsvAmount([
      {
        taxCode: "isv_15",
        taxAmount: 180,
        taxBreakdown: [
          {
            taxCode: "isv_15",
            label: "ISV 15%",
            shortLabel: "ISV 15%",
            taxType: "base",
            fiscalCategory: "gravado",
            ratePercent: 15,
            rate: 0.15,
            baseAmount: 1000,
            amount: 150,
            displayOrder: 1,
          },
          {
            taxCode: "additional_3",
            label: "Adicional 3%",
            shortLabel: "Adicional",
            taxType: "additional",
            fiscalCategory: "gravado",
            ratePercent: 3,
            rate: 0.03,
            baseAmount: 1000,
            amount: 30,
            displayOrder: 2,
          },
        ],
      },
    ]);

    expect(baseIsv).toBe(150);
  });

  it("falls back to legacy ISV lines and treats zero percentages as disabled", () => {
    const baseIsv = getInvoiceBaseIsvAmount([
      { taxCode: "isv_18", taxAmount: "18.0000" },
      { taxCode: "exe", taxAmount: "99.0000" },
    ]);
    const result = calculateInvoiceDocumentAdjustments({
      subtotal: 100,
      baseIsvAmount: baseIsv,
      input: {
        qualityRetentionPercent: 0,
        advanceAmortizationPercent: 0,
        promptPaymentPercent: 0,
        tcEnabled: false,
      },
    });

    expect(baseIsv).toBe(18);
    expect(result.calculations).toEqual([]);
    expect(result.otherRetentionTotal).toBe(0);
    expect(result.documentDiscountTotal).toBe(0);
  });

  it("rounds editable percentages to two decimals and money to four", () => {
    const result = calculateInvoiceDocumentAdjustments({
      subtotal: 123.4567,
      baseIsvAmount: 0,
      input: { qualityRetentionPercent: 1.236 },
    });

    expect(result.calculations[0]).toMatchObject({
      inputMode: "percentage",
      percentage: 1.24,
      amount: 1.5309,
    });
  });

  it("keeps an entered amount exact and derives its percentage", () => {
    const result = calculateInvoiceDocumentAdjustments({
      subtotal: 137676,
      baseIsvAmount: 0,
      input: {
        qualityRetentionPercent: 99,
        qualityRetentionAmount: 10000,
      },
    });

    expect(result.calculations[0]).toEqual({
      adjustmentType: "quality_retention",
      inputMode: "amount",
      percentage: 7.26343008,
      baseAmount: 137676,
      amount: 10000,
    });
    expect(result.otherRetentionTotal).toBe(10000);
  });

  it("treats an entered zero amount as disabled even when a percentage exists", () => {
    const result = calculateInvoiceDocumentAdjustments({
      subtotal: 1000,
      baseIsvAmount: 0,
      input: {
        advanceAmortizationPercent: 10,
        advanceAmortizationAmount: 0,
      },
    });

    expect(result.calculations).toEqual([]);
  });
});
