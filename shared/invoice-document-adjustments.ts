import { parsePurchaseOrderTaxBreakdown } from "./purchase-orders";

export const INVOICE_DOCUMENT_ADJUSTMENT_TYPES = [
  "quality_retention",
  "advance_amortization",
  "prompt_payment_discount",
  "tc_discount",
] as const;

export type InvoiceDocumentAdjustmentType =
  (typeof INVOICE_DOCUMENT_ADJUSTMENT_TYPES)[number];

export type InvoiceDocumentAdjustmentInput = {
  qualityRetentionPercent?: string | number | null;
  advanceAmortizationPercent?: string | number | null;
  promptPaymentPercent?: string | number | null;
  tcEnabled?: boolean | null;
};

export type InvoiceDocumentAdjustmentCalculation = {
  adjustmentType: InvoiceDocumentAdjustmentType;
  percentage: number;
  baseAmount: number;
  amount: number;
};

export const TC_DISCOUNT_PERCENT = 8;

function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundInvoiceAdjustmentMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function roundInvoiceAdjustmentPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getInvoiceBaseIsvAmount(
  items: Array<{
    taxCode?: string | null;
    taxAmount?: string | number | null;
    taxBreakdown?: unknown;
  }>
) {
  return roundInvoiceAdjustmentMoney(
    items.reduce((invoiceSum, item) => {
      const breakdown = parsePurchaseOrderTaxBreakdown(
        item.taxBreakdown as any
      );
      if (breakdown.length > 0) {
        return (
          invoiceSum +
          breakdown
            .filter(
              entry =>
                entry.taxType === "base" && entry.fiscalCategory === "gravado"
            )
            .reduce((sum, entry) => sum + numberValue(entry.amount), 0)
        );
      }

      const taxCode = String(item.taxCode ?? "")
        .trim()
        .toLowerCase();
      return taxCode.startsWith("isv_")
        ? invoiceSum + numberValue(item.taxAmount)
        : invoiceSum;
    }, 0)
  );
}

export function calculateInvoiceDocumentAdjustments(params: {
  subtotal: string | number | null | undefined;
  baseIsvAmount: string | number | null | undefined;
  input: InvoiceDocumentAdjustmentInput;
}) {
  const subtotal = roundInvoiceAdjustmentMoney(
    Math.max(0, numberValue(params.subtotal))
  );
  const baseIsvAmount = roundInvoiceAdjustmentMoney(
    Math.max(0, numberValue(params.baseIsvAmount))
  );
  const calculations: InvoiceDocumentAdjustmentCalculation[] = [];

  const addPercentageAdjustment = (
    adjustmentType: InvoiceDocumentAdjustmentType,
    percentageValue: string | number | null | undefined
  ) => {
    const percentage = roundInvoiceAdjustmentPercent(
      numberValue(percentageValue)
    );
    if (percentage <= 0) return;
    calculations.push({
      adjustmentType,
      percentage,
      baseAmount: subtotal,
      amount: roundInvoiceAdjustmentMoney((subtotal * percentage) / 100),
    });
  };

  addPercentageAdjustment(
    "quality_retention",
    params.input.qualityRetentionPercent
  );
  addPercentageAdjustment(
    "advance_amortization",
    params.input.advanceAmortizationPercent
  );
  addPercentageAdjustment(
    "prompt_payment_discount",
    params.input.promptPaymentPercent
  );

  if (params.input.tcEnabled) {
    calculations.push({
      adjustmentType: "tc_discount",
      percentage: TC_DISCOUNT_PERCENT,
      baseAmount: baseIsvAmount,
      amount: roundInvoiceAdjustmentMoney(
        (baseIsvAmount * TC_DISCOUNT_PERCENT) / 100
      ),
    });
  }

  const otherRetentionTotal = roundInvoiceAdjustmentMoney(
    calculations
      .filter(calculation =>
        ["quality_retention", "advance_amortization"].includes(
          calculation.adjustmentType
        )
      )
      .reduce((sum, calculation) => sum + calculation.amount, 0)
  );
  const documentDiscountTotal = roundInvoiceAdjustmentMoney(
    calculations
      .filter(calculation =>
        ["prompt_payment_discount", "tc_discount"].includes(
          calculation.adjustmentType
        )
      )
      .reduce((sum, calculation) => sum + calculation.amount, 0)
  );

  return {
    calculations,
    otherRetentionTotal,
    documentDiscountTotal,
  };
}

export function calculateInvoiceNetPayable(params: {
  total: string | number | null | undefined;
  fiscalRetentionTotal?: string | number | null;
  otherRetentionTotal?: string | number | null;
  documentDiscountTotal?: string | number | null;
}) {
  return roundInvoiceAdjustmentMoney(
    numberValue(params.total) -
      numberValue(params.fiscalRetentionTotal) -
      numberValue(params.otherRetentionTotal) -
      numberValue(params.documentDiscountTotal)
  );
}

export function getInvoiceDocumentAdjustment(
  adjustments: Array<{
    adjustmentType: string;
    percentage?: string | number | null;
    baseAmount?: string | number | null;
    amount?: string | number | null;
  }>,
  adjustmentType: InvoiceDocumentAdjustmentType
) {
  return adjustments.find(
    adjustment => adjustment.adjustmentType === adjustmentType
  );
}
