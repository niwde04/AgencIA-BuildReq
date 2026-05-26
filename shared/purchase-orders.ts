export const PURCHASE_ORDER_TAX_VALUES = ["exe", "isv_15"] as const;

export type PurchaseOrderTaxCode = (typeof PURCHASE_ORDER_TAX_VALUES)[number];

export const DEFAULT_PURCHASE_ORDER_TAX_CODE: PurchaseOrderTaxCode = "exe";

export const PURCHASE_ORDER_CONTRACT_FREQUENCIES = [
  "semanal",
  "quincenal",
  "mensual",
  "trimestral",
  "semestral",
  "anual",
] as const;

export type PurchaseOrderContractFrequency =
  (typeof PURCHASE_ORDER_CONTRACT_FREQUENCIES)[number];

export const PURCHASE_ORDER_CONTRACT_FREQUENCY_LABELS: Record<
  PurchaseOrderContractFrequency,
  string
> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

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

function toContractDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(
          Number(value.slice(0, 4)),
          Number(value.slice(5, 7)) - 1,
          Number(value.slice(8, 10)),
          12
        )
      : value instanceof Date
        ? value
        : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonthsClamped(date: Date, months: number) {
  const targetMonthStart = new Date(
    date.getFullYear(),
    date.getMonth() + months,
    1,
    12
  );
  const lastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0
  ).getDate();
  targetMonthStart.setDate(Math.min(date.getDate(), lastDay));
  return targetMonthStart;
}

export function normalizePurchaseOrderContractFrequency(
  value: string | null | undefined
): PurchaseOrderContractFrequency | null {
  return PURCHASE_ORDER_CONTRACT_FREQUENCIES.includes(
    value as PurchaseOrderContractFrequency
  )
    ? (value as PurchaseOrderContractFrequency)
    : null;
}

export function calculateContractPaymentDates(params: {
  frequency?: string | null;
  firstPaymentDate?: string | Date | null;
  endDate?: string | Date | null;
}) {
  const frequency = normalizePurchaseOrderContractFrequency(params.frequency);
  const firstPaymentDate = toContractDate(params.firstPaymentDate);
  const endDate = toContractDate(params.endDate);

  if (!frequency || !firstPaymentDate || !endDate || firstPaymentDate > endDate) {
    return [];
  }

  const dates: Date[] = [];
  let cursor = firstPaymentDate;
  let guard = 0;

  while (cursor <= endDate && guard < 600) {
    dates.push(cursor);
    if (frequency === "semanal") {
      cursor = addDays(cursor, 7);
    } else if (frequency === "quincenal") {
      cursor = addDays(cursor, 15);
    } else {
      const months =
        frequency === "mensual"
          ? 1
          : frequency === "trimestral"
            ? 3
            : frequency === "semestral"
              ? 6
              : 12;
      cursor = addMonthsClamped(cursor, months);
    }
    guard += 1;
  }

  return dates;
}

export function getPurchaseOrderContractSummary(params: {
  appliesContract?: boolean | null;
  contractPaymentFrequency?: string | null;
  contractFirstPaymentDate?: string | Date | null;
  contractEndDate?: string | Date | null;
  registeredInvoiceCount?: number | string | null;
  now?: Date;
}) {
  const appliesContract = params.appliesContract === true;
  const paymentDates = appliesContract
    ? calculateContractPaymentDates({
        frequency: params.contractPaymentFrequency,
        firstPaymentDate: params.contractFirstPaymentDate,
        endDate: params.contractEndDate,
      })
    : [];
  const registeredInvoiceCount = Math.max(
    Number(params.registeredInvoiceCount ?? 0) || 0,
    0
  );
  const expectedInvoiceCount = paymentDates.length;
  const remainingInvoiceCount = Math.max(
    expectedInvoiceCount - registeredInvoiceCount,
    0
  );
  const now = toContractDate(params.now ?? new Date()) ?? new Date();
  const endDate = toContractDate(params.contractEndDate);
  const daysUntilEnd = endDate
    ? Math.ceil((endDate.getTime() - now.getTime()) / 86_400_000)
    : null;
  const isExpired = endDate ? daysUntilEnd !== null && daysUntilEnd < 0 : false;
  const expiresSoon =
    endDate && daysUntilEnd !== null
      ? !isExpired && daysUntilEnd <= 30
      : false;
  const isFullyInvoiced =
    appliesContract &&
    expectedInvoiceCount > 0 &&
    registeredInvoiceCount >= expectedInvoiceCount;

  return {
    appliesContract,
    paymentDates,
    expectedInvoiceCount,
    registeredInvoiceCount,
    remainingInvoiceCount,
    daysUntilEnd,
    expiresSoon,
    isExpired,
    isFullyInvoiced,
    statusLabel: appliesContract
      ? `Pendiente ${registeredInvoiceCount} de ${expectedInvoiceCount}`
      : "",
  };
}
