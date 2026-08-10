import type { PurchaseCurrency } from "./purchase-orders";

export const TREASURY_PAYMENTS_HEADERS = [
  "Lote",
  "Referencia Bancaria",
  "Fecha emision Factura",
  "Nro. Factura",
  "Razón Social",
  "Descripción Compra (concatenada (cantidad) +item )",
  "COD DE JOB",
  "COD FINANCIERO",
  "TOTAL FACTURA",
  "ANTICIPOS",
  "TOTAL RETENCIONES",
  "Neto pagar",
] as const;

export type TreasuryPaymentsReportRow = {
  batchNumber: string;
  bankReference: string;
  invoiceDate: Date | string | null;
  invoiceNumber: string;
  supplierName: string;
  purchaseDescription: string;
  jobCode: string;
  financialCode: "";
  invoiceTotal: number;
  advances: number;
  totalRetentions: number;
  netPayable: number;
  currency: PurchaseCurrency;
};

export type TreasuryPaymentsReportPayload = {
  generatedAt: Date;
  payments: TreasuryPaymentsReportRow[];
};

export function formatTreasuryPaymentItemQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return String(value ?? "").trim();
  return quantity.toFixed(2).replace(/\.0+$|(?<=\.[0-9])0+$/, "");
}

export function buildTreasuryPaymentPurchaseDescription(
  items: Array<{ quantity: unknown; itemName: string }>
) {
  return items
    .map(item => {
      const quantity = formatTreasuryPaymentItemQuantity(item.quantity);
      const name = item.itemName.trim();
      return `(${quantity}) ${name}`.trim();
    })
    .filter(Boolean)
    .join(" / ");
}
