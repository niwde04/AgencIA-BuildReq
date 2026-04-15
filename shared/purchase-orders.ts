export const PURCHASE_ORDER_TAX_VALUES = ["exe", "isv_15"] as const;

export type PurchaseOrderTaxCode = (typeof PURCHASE_ORDER_TAX_VALUES)[number];

export const DEFAULT_PURCHASE_ORDER_TAX_CODE: PurchaseOrderTaxCode = "exe";

export const PURCHASE_ORDER_TAX_OPTIONS = [
  {
    value: "exe" as const,
    label: "EXE - Exento",
    shortLabel: "EXE",
    rate: 0,
  },
  {
    value: "isv_15" as const,
    label: "ISV 15%",
    shortLabel: "ISV 15%",
    rate: 0.15,
  },
];

export function normalizePurchaseOrderTaxCode(
  value: string | null | undefined
): PurchaseOrderTaxCode {
  return PURCHASE_ORDER_TAX_VALUES.includes(value as PurchaseOrderTaxCode)
    ? (value as PurchaseOrderTaxCode)
    : DEFAULT_PURCHASE_ORDER_TAX_CODE;
}

export function getPurchaseOrderTaxMeta(value: string | null | undefined) {
  const taxCode = normalizePurchaseOrderTaxCode(value);
  return (
    PURCHASE_ORDER_TAX_OPTIONS.find((option) => option.value === taxCode) ??
    PURCHASE_ORDER_TAX_OPTIONS[0]
  );
}

export function toPurchaseOrderNumber(
  value: string | number | null | undefined
) {
  const parsed =
    typeof value === "number"
      ? value
      : value === null || value === undefined || value === ""
      ? 0
      : Number(String(value).replace(/,/g, "").trim());

  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundPurchaseOrderMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculatePurchaseOrderLineAmounts(params: {
  quantity: string | number | null | undefined;
  unitPrice?: string | number | null | undefined;
  taxCode?: string | null | undefined;
}) {
  const quantity = toPurchaseOrderNumber(params.quantity);
  const unitPrice = toPurchaseOrderNumber(params.unitPrice);
  const tax = getPurchaseOrderTaxMeta(params.taxCode);
  const subtotal = roundPurchaseOrderMoney(quantity * unitPrice);
  const taxAmount = roundPurchaseOrderMoney(subtotal * tax.rate);
  const total = roundPurchaseOrderMoney(subtotal + taxAmount);

  return {
    quantity,
    unitPrice,
    taxCode: tax.value,
    taxLabel: tax.label,
    taxShortLabel: tax.shortLabel,
    taxRate: tax.rate,
    subtotal,
    taxAmount,
    total,
  };
}

export function summarizePurchaseOrderLines(
  lines: Array<{
    quantity: string | number | null | undefined;
    unitPrice?: string | number | null | undefined;
    taxCode?: string | null | undefined;
  }>
) {
  return lines.reduce(
    (summary, line) => {
      const amounts = calculatePurchaseOrderLineAmounts(line);

      summary.subtotal = roundPurchaseOrderMoney(
        summary.subtotal + amounts.subtotal
      );
      summary.totalIsv = roundPurchaseOrderMoney(
        summary.totalIsv + amounts.taxAmount
      );
      summary.totalExempt = roundPurchaseOrderMoney(
        summary.totalExempt +
          (amounts.taxRate === 0 ? amounts.subtotal : 0)
      );
      summary.total = roundPurchaseOrderMoney(summary.total + amounts.total);

      return summary;
    },
    {
      subtotal: 0,
      totalIsv: 0,
      totalExempt: 0,
      total: 0,
    }
  );
}

export function formatPurchaseOrderCurrency(
  value: string | number | null | undefined
) {
  return new Intl.NumberFormat("es-HN", {
    style: "currency",
    currency: "HNL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toPurchaseOrderNumber(value));
}
