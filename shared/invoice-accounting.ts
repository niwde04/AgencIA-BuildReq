import type { PurchaseOrderTaxBreakdownEntry } from "./purchase-orders";
import { roundDecimalAmount } from "./money";

export const INVOICE_ACCOUNTING_STATUS_LABELS: Record<string, string> = {
  pendiente_contabilizar: "Pendiente de contabilizar",
  registrada: "Contabilizada",
  rechazada: "Rechazada",
  anulada: "Anulada",
};
export type InvoiceTaxSummary = {
  code: string;
  label: string;
  ratePercent: number | null;
  amount: number;
};
const money = (value: number) => roundDecimalAmount(value, 4);

// Read historical snapshots; catalog edits must never reprice existing invoices.
export function summarizeInvoiceTaxes(
  items: Array<{
    taxCode: string;
    taxAmount: string | number;
    taxBreakdown: PurchaseOrderTaxBreakdownEntry[];
  }>,
  total: number
): InvoiceTaxSummary[] {
  const entries = new Map<string, InvoiceTaxSummary>();
  const add = (key: string, value: InvoiceTaxSummary) => {
    const previous = entries.get(key);
    entries.set(key, {
      ...value,
      amount: money((previous?.amount ?? 0) + value.amount),
    });
  };
  for (const item of items) {
    if (item.taxBreakdown?.length) {
      for (const tax of item.taxBreakdown) {
        if (!tax.amount) continue;
        add(tax.taxCode + ":" + tax.ratePercent, {
          code: tax.taxCode,
          label: tax.label || tax.shortLabel || tax.taxCode,
          ratePercent: tax.ratePercent,
          amount: Number(tax.amount),
        });
      }
    } else if (Number(item.taxAmount)) {
      add(item.taxCode, {
        code: item.taxCode,
        label: item.taxCode,
        ratePercent: null,
        amount: Number(item.taxAmount),
      });
    }
  }
  const difference = money(
    total -
      Array.from(entries.values()).reduce((sum, entry) => sum + entry.amount, 0)
  );
  if (difference)
    add("invoice-adjustment", {
      code: "invoice-adjustment",
      label: entries.size
        ? "Ajuste / exoneración del documento"
        : "Impuesto registrado sin desglose",
      ratePercent: null,
      amount: difference,
    });
  return Array.from(entries.values());
}

export function summarizeInvoiceRetentions(
  retentions: Array<{
    percentage: string | number | null;
    amount: string | number;
  }>,
  retentionTotal: number,
  otherRetentionTotal: number
) {
  const amounts = { one: 0, ten: 0, services: 0, fifteen: 0, twentyFive: 0 };
  const keys = new Map<number, keyof typeof amounts>([
    [1, "one"],
    [10, "ten"],
    [12.5, "services"],
    [15, "fifteen"],
    [25, "twentyFive"],
  ]);
  for (const retention of retentions) {
    const key = keys.get(Number(retention.percentage));
    if (key) amounts[key] = money(amounts[key] + Number(retention.amount));
  }
  return {
    ...amounts,
    other: money(
      retentionTotal -
        Object.values(amounts).reduce((sum, amount) => sum + amount, 0) +
        otherRetentionTotal
    ),
  };
}

export function invoiceAccountingBalance(
  netPayable: number,
  appliedAdvance: number,
  paid: number
) {
  // netPayable already includes credit/debit notes and retentions.
  return money(Math.max(0, netPayable - appliedAdvance - paid));
}
