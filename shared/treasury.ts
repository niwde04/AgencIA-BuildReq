import type { PurchaseCurrency } from "./purchase-orders";

export const TREASURY_PAYMENT_KIND_CODES = [
  "invoice",
  "purchase_order_advance",
  "quality_retention_release",
] as const;
export type TreasuryPaymentKind = (typeof TREASURY_PAYMENT_KIND_CODES)[number];
export type TreasuryPaymentSourceType = TreasuryPaymentKind;

export const TREASURY_PAYMENT_KIND_LABELS: Readonly<
  Record<TreasuryPaymentKind, string>
> = {
  invoice: "Pago de facturas",
  purchase_order_advance: "Anticipo a proveedor",
  quality_retention_release: "Liberación de retención de calidad",
};

export const TREASURY_BATCH_STATUS_CODES = [
  "borrador",
  "enviado_depuracion",
  "pendiente_aprobacion",
  "aprobado",
  "enviado_banco",
  "conciliacion",
  "pendiente_contabilizacion",
  "cerrado",
  "devuelto",
  "rechazado",
  "anulado",
  "consolidado",
] as const;

export type TreasuryBatchStatus = (typeof TREASURY_BATCH_STATUS_CODES)[number];

export const TREASURY_BATCH_STATUS_LABELS: Readonly<
  Record<TreasuryBatchStatus, string>
> = {
  borrador: "Borrador",
  enviado_depuracion: "Pendiente de revisión",
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobado: "Aprobado",
  enviado_banco: "Enviado al banco",
  conciliacion: "Conciliación con diferencias",
  pendiente_contabilizacion: "Pendiente de contabilización",
  cerrado: "Cerrado",
  devuelto: "Devuelto",
  rechazado: "Rechazado",
  anulado: "Anulado",
  consolidado: "Consolidado",
};

export function getTreasuryBatchStatusLabel(
  status: TreasuryBatchStatus,
  approvalBypassed = false
) {
  if (status === "aprobado" && approvalBypassed) return "Listo para banco";
  return TREASURY_BATCH_STATUS_LABELS[status];
}

function normalizeTreasurySearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("es-HN");
}

function normalizeTreasuryDocumentIdentifier(value: unknown) {
  const tokens = normalizeTreasurySearchText(value).match(/[a-z]+|\d+/g);
  if (!tokens?.length) return "";
  return tokens
    .map(token =>
      /^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, "") : token
    )
    .join("|");
}

export function matchesTreasuryBatchSearch(input: {
  search: string;
  values: unknown[];
  invoiceDocumentNumbers?: Array<string | null | undefined>;
  invoiceNumbers?: Array<string | null | undefined>;
}) {
  const term = normalizeTreasurySearchText(input.search);
  if (!term) return true;

  const searchableText = input.values
    .map(normalizeTreasurySearchText)
    .join(" ");
  if (searchableText.includes(term)) return true;

  const documentValues = [
    ...(input.invoiceDocumentNumbers ?? []),
    ...(input.invoiceNumbers ?? []),
  ];
  if (
    documentValues.some(value =>
      normalizeTreasurySearchText(value).includes(term)
    )
  ) {
    return true;
  }

  const normalizedTerm = normalizeTreasuryDocumentIdentifier(term);
  if (!normalizedTerm) return false;

  return documentValues.some(value =>
    normalizeTreasuryDocumentIdentifier(value).includes(normalizedTerm)
  );
}

export const TREASURY_ITEM_STATUS_CODES = [
  "incluida",
  "excluida",
  "aprobada",
  "pagada",
  "rechazada_banco",
  "con_diferencia",
  "contabilizada",
] as const;

export type TreasuryItemStatus = (typeof TREASURY_ITEM_STATUS_CODES)[number];

export const TREASURY_ITEM_STATUS_LABELS: Readonly<
  Record<TreasuryItemStatus, string>
> = {
  incluida: "Incluida",
  excluida: "Excluida",
  aprobada: "Aprobada",
  pagada: "Pagada por el banco",
  rechazada_banco: "Rechazada por el banco",
  con_diferencia: "Con diferencia",
  contabilizada: "Contabilizada",
};

export const TREASURY_PAYMENT_STATUS_CODES = [
  "sin_pago",
  "parcialmente_pagada",
  "pagada",
] as const;

export type TreasuryPaymentStatus =
  (typeof TREASURY_PAYMENT_STATUS_CODES)[number];

export type TreasuryMoneySummary = {
  currency: PurchaseCurrency;
  invoiceNetPayable: number;
  appliedAdvanceAmount: number;
  payableAfterAdvance: number;
  paidAmount: number;
  reservedAmount: number;
  availableAmount: number;
  paymentStatus: TreasuryPaymentStatus;
};

export type InvoiceAdvanceBalance = {
  actualAppliedAmount: number;
  pendingApplicationAmount: number;
  displayedAppliedAmount: number;
  balanceAfterAdvance: number;
  isPendingApplication: boolean;
};

export const TREASURY_BANK_RESULT_VALUES = ["PAGADO", "RECHAZADO"] as const;
export type TreasuryBankResult = (typeof TREASURY_BANK_RESULT_VALUES)[number];

export const TREASURY_ACTIVE_ITEM_STATUSES: ReadonlySet<string> = new Set([
  "incluida",
  "aprobada",
  "pagada",
  "con_diferencia",
]);

export function roundTreasuryMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildInvoiceAdvanceBalance(input: {
  invoiceStatus: string;
  netPayable: string | number;
  appliedAdvanceAmount?: string | number | null;
  availableAccountedAdvanceAmount?: string | number | null;
}): InvoiceAdvanceBalance {
  const netPayable = roundTreasuryMoney(Math.max(0, Number(input.netPayable)));
  const actualAppliedAmount = roundTreasuryMoney(
    Math.max(0, Number(input.appliedAdvanceAmount ?? 0))
  );
  const canPreviewApplication = ["borrador", "revisada", "rechazada"].includes(
    input.invoiceStatus
  );
  const pendingApplicationAmount = canPreviewApplication
    ? roundTreasuryMoney(
        Math.min(
          Math.max(0, netPayable - actualAppliedAmount),
          Math.max(0, Number(input.availableAccountedAdvanceAmount ?? 0))
        )
      )
    : 0;
  const displayedAppliedAmount = roundTreasuryMoney(
    Math.min(netPayable, actualAppliedAmount + pendingApplicationAmount)
  );

  return {
    actualAppliedAmount,
    pendingApplicationAmount,
    displayedAppliedAmount,
    balanceAfterAdvance: roundTreasuryMoney(
      Math.max(0, netPayable - displayedAppliedAmount)
    ),
    isPendingApplication: pendingApplicationAmount > 0,
  };
}

export function getTreasuryPaymentStatus(
  invoiceNetPayable: number,
  paidAmount: number
): TreasuryPaymentStatus {
  const total = roundTreasuryMoney(Math.max(0, invoiceNetPayable));
  const paid = roundTreasuryMoney(Math.max(0, paidAmount));
  if (paid <= 0) return "sin_pago";
  if (paid >= total) return "pagada";
  return "parcialmente_pagada";
}

export function buildTreasuryMoneySummary(input: {
  currency: PurchaseCurrency;
  invoiceNetPayable: string | number;
  appliedAdvanceAmount?: string | number | null;
  paidAmount?: string | number | null;
  reservedAmount?: string | number | null;
}): TreasuryMoneySummary {
  const invoiceNetPayable = roundTreasuryMoney(Number(input.invoiceNetPayable));
  const appliedAdvanceAmount = roundTreasuryMoney(
    Number(input.appliedAdvanceAmount ?? 0)
  );
  const payableAfterAdvance = roundTreasuryMoney(
    Math.max(0, invoiceNetPayable - appliedAdvanceAmount)
  );
  const paidAmount = roundTreasuryMoney(Number(input.paidAmount ?? 0));
  const reservedAmount = roundTreasuryMoney(Number(input.reservedAmount ?? 0));
  return {
    currency: input.currency,
    invoiceNetPayable,
    appliedAdvanceAmount,
    payableAfterAdvance,
    paidAmount,
    reservedAmount,
    availableAmount: roundTreasuryMoney(
      Math.max(0, payableAfterAdvance - paidAmount - reservedAmount)
    ),
    paymentStatus: getTreasuryPaymentStatus(
      invoiceNetPayable,
      paidAmount + appliedAdvanceAmount
    ),
  };
}
