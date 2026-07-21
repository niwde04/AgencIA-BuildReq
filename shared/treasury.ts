import type { PurchaseCurrency } from "./purchase-orders";

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
  "anulado",
] as const;

export type TreasuryBatchStatus = (typeof TREASURY_BATCH_STATUS_CODES)[number];

export const TREASURY_BATCH_STATUS_LABELS: Readonly<
  Record<TreasuryBatchStatus, string>
> = {
  borrador: "Borrador",
  enviado_depuracion: "Pendiente de depuración",
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobado: "Aprobado",
  enviado_banco: "Enviado al banco",
  conciliacion: "Conciliación con diferencias",
  pendiente_contabilizacion: "Pendiente de contabilización",
  cerrado: "Cerrado",
  devuelto: "Devuelto",
  anulado: "Anulado",
};

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
  paidAmount: number;
  reservedAmount: number;
  availableAmount: number;
  paymentStatus: TreasuryPaymentStatus;
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
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function getTreasuryPaymentStatus(
  invoiceNetPayable: number,
  paidAmount: number
): TreasuryPaymentStatus {
  const total = roundTreasuryMoney(Math.max(0, invoiceNetPayable));
  const paid = roundTreasuryMoney(Math.max(0, paidAmount));
  if (paid <= 0) return "sin_pago";
  if (paid + 0.0001 >= total) return "pagada";
  return "parcialmente_pagada";
}

export function buildTreasuryMoneySummary(input: {
  currency: PurchaseCurrency;
  invoiceNetPayable: string | number;
  paidAmount?: string | number | null;
  reservedAmount?: string | number | null;
}): TreasuryMoneySummary {
  const invoiceNetPayable = roundTreasuryMoney(Number(input.invoiceNetPayable));
  const paidAmount = roundTreasuryMoney(Number(input.paidAmount ?? 0));
  const reservedAmount = roundTreasuryMoney(Number(input.reservedAmount ?? 0));
  return {
    currency: input.currency,
    invoiceNetPayable,
    paidAmount,
    reservedAmount,
    availableAmount: roundTreasuryMoney(
      Math.max(0, invoiceNetPayable - paidAmount - reservedAmount)
    ),
    paymentStatus: getTreasuryPaymentStatus(invoiceNetPayable, paidAmount),
  };
}
