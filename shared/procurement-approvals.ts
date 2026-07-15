import type { PurchaseCurrency } from "./purchase-orders";

export const PURCHASE_ORDER_APPROVAL_LIMITS = {
  HNL: 250_000,
  USD: 10_000,
} as const satisfies Record<PurchaseCurrency, number>;

export type ProcurementApprovalDecision = "approve" | "reject";
export type ProcurementApprovalDocumentType =
  | "purchase_request"
  | "purchase_order";

export type PurchaseOrderApprovalReadinessInput = {
  supplierId?: number | null;
  classification?: string | null;
  purchaseType?: string | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  exchangeRateDate?: string | Date | null;
  paymentMethod?: string | null;
  directPurchasePaymentMethod?: string | null;
  appliesContract?: boolean | null;
  contractPaymentFrequency?: string | null;
  contractFirstPaymentDate?: string | Date | null;
  contractEndDate?: string | Date | null;
  items?: Array<{
    unitPrice?: string | number | null;
    subtotal?: string | number | null;
  }> | null;
};

function isValidDateValue(value: unknown) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(String(value));
  return !Number.isNaN(date.getTime());
}

export function getPurchaseOrderApprovalReadinessError(
  input: PurchaseOrderApprovalReadinessInput
) {
  if (!input.supplierId) {
    return "Seleccione un proveedor antes de emitir la OC";
  }

  const items = input.items ?? [];
  if (items.length === 0) {
    return "La orden debe tener al menos una línea";
  }

  if (input.currency !== "HNL" && input.currency !== "USD") {
    return "Seleccione una moneda válida para la orden de compra";
  }

  if (input.currency === "USD") {
    const rawRate = String(input.exchangeRate ?? "").trim();
    if (!/^\d{1,10}(?:\.\d{1,8})?$/.test(rawRate)) {
      return "Ingrese una tasa referencial válida, positiva y con máximo 8 decimales";
    }
    const rate = Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return "La tasa referencial debe ser mayor que cero";
    }
    if (!isValidDateValue(input.exchangeRateDate)) {
      return "Seleccione la fecha de la tasa referencial";
    }
  }

  if (
    (input.classification === "cd" ||
      input.purchaseType === "compra_directa") &&
    !input.paymentMethod &&
    !input.directPurchasePaymentMethod
  ) {
    return "Seleccione el método de pago para la orden de compra";
  }

  if (
    input.appliesContract &&
    (!input.contractPaymentFrequency ||
      !isValidDateValue(input.contractFirstPaymentDate) ||
      !isValidDateValue(input.contractEndDate))
  ) {
    return "Complete todos los datos del contrato antes de continuar";
  }

  const invalidLine = items.find(
    item =>
      !Number.isFinite(Number(item.unitPrice ?? 0)) ||
      Number(item.unitPrice ?? 0) <= 0 ||
      !Number.isFinite(Number(item.subtotal ?? 0)) ||
      Number(item.subtotal ?? 0) <= 0
  );
  if (invalidLine) {
    return "Ingrese precio unitario y subtotal mayores que cero antes de emitir la OC";
  }

  return null;
}

export function roundProcurementAmount(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(numeric)) * 4;
  return Math.round((numeric + tolerance) * 100) / 100;
}

export function purchaseOrderRequiresApproval(
  currency: PurchaseCurrency,
  total: unknown
) {
  return (
    roundProcurementAmount(total) > PURCHASE_ORDER_APPROVAL_LIMITS[currency]
  );
}

export function formatApprovalSnapshotAmount(value: unknown) {
  return roundProcurementAmount(value).toFixed(2);
}
