import type { PurchaseCurrency } from "./purchase-orders";

/**
 * Interruptor temporal del flujo de aprobación de Solicitudes y Órdenes de
 * Compra. Mantener la lógica detrás de este flag permite reactivarla sin
 * reconstruir el flujo.
 */
export const PROCUREMENT_APPROVALS_ENABLED = false;

export type ProcurementApprovalSettings = {
  purchaseRequestApprovalsEnabled: boolean;
  purchaseOrderApprovalsEnabled: boolean;
  purchaseOrderApprovalMinimumHnl: number;
  purchaseOrderApprovalMinimumUsd: number;
  updatedAt?: Date | string | null;
};

export const DEFAULT_PROCUREMENT_APPROVAL_SETTINGS: ProcurementApprovalSettings =
  {
    purchaseRequestApprovalsEnabled: false,
    purchaseOrderApprovalsEnabled: false,
    purchaseOrderApprovalMinimumHnl: 0,
    purchaseOrderApprovalMinimumUsd: 0,
  };

let runtimeProcurementApprovalSettings: ProcurementApprovalSettings = {
  ...DEFAULT_PROCUREMENT_APPROVAL_SETTINGS,
};

export function setRuntimeProcurementApprovalSettings(
  settings: ProcurementApprovalSettings
) {
  const currentUpdatedAt = runtimeProcurementApprovalSettings.updatedAt
    ? new Date(runtimeProcurementApprovalSettings.updatedAt).getTime()
    : 0;
  const nextUpdatedAt = settings.updatedAt
    ? new Date(settings.updatedAt).getTime()
    : Date.now();

  if (Number.isFinite(currentUpdatedAt) && nextUpdatedAt < currentUpdatedAt) {
    return runtimeProcurementApprovalSettings;
  }

  runtimeProcurementApprovalSettings = {
    purchaseRequestApprovalsEnabled:
      settings.purchaseRequestApprovalsEnabled === true,
    purchaseOrderApprovalsEnabled:
      settings.purchaseOrderApprovalsEnabled === true,
    purchaseOrderApprovalMinimumHnl: normalizeApprovalMinimum(
      settings.purchaseOrderApprovalMinimumHnl
    ),
    purchaseOrderApprovalMinimumUsd: normalizeApprovalMinimum(
      settings.purchaseOrderApprovalMinimumUsd
    ),
    updatedAt: settings.updatedAt ?? new Date(nextUpdatedAt),
  };
  return runtimeProcurementApprovalSettings;
}

export function getRuntimeProcurementApprovalSettings() {
  return runtimeProcurementApprovalSettings;
}

export function isPurchaseRequestApprovalEnabled() {
  return runtimeProcurementApprovalSettings.purchaseRequestApprovalsEnabled;
}

export function isPurchaseOrderApprovalEnabled() {
  return runtimeProcurementApprovalSettings.purchaseOrderApprovalsEnabled;
}

export const PROCUREMENT_APPROVALS_DISABLED_MESSAGE =
  "El flujo de aprobación de Solicitudes y Órdenes de Compra está deshabilitado temporalmente";

export type ProcurementApprovalDecision = "approve" | "reject";
export type ProcurementApprovalDocumentType =
  | "purchase_request"
  | "purchase_order";

const PURCHASE_REQUEST_DRAFT_LIKE_STATUSES_WITH_APPROVALS_DISABLED = new Set([
  "pendiente",
  "en_revision",
  "rechazada",
]);

const PURCHASE_REQUEST_CONVERTIBLE_STATUSES = new Set([
  "aprobada",
  "parcialmente_convertida",
]);

const PURCHASE_REQUEST_CONVERTIBLE_STATUSES_WITH_APPROVALS_DISABLED = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
  "rechazada",
  "parcialmente_convertida",
]);

const PURCHASE_ORDER_DRAFT_LIKE_STATUSES_WITH_APPROVALS_DISABLED = new Set([
  "borrador",
  "pendiente_aprobacion",
  "rechazada",
]);

export function isPurchaseRequestDraftLike(
  status?: string | null,
  approvalStatus?: string | null,
  approvalsEnabled = isPurchaseRequestApprovalEnabled()
) {
  if (approvalsEnabled) {
    return status === "pendiente" && approvalStatus == null;
  }
  return (
    status === "pendiente" ||
    (approvalStatus != null &&
      PURCHASE_REQUEST_DRAFT_LIKE_STATUSES_WITH_APPROVALS_DISABLED.has(
        status ?? ""
      ))
  );
}

export function isPurchaseRequestConversionReady(
  status?: string | null,
  approvalStatus?: string | null,
  approvalsEnabled = isPurchaseRequestApprovalEnabled()
) {
  if (approvalsEnabled) {
    return (
      (approvalStatus === "aprobada" &&
        PURCHASE_REQUEST_CONVERTIBLE_STATUSES.has(status ?? "")) ||
      (status === "parcialmente_convertida" && approvalStatus === "no_requiere")
    );
  }
  return (
    status === "pendiente" ||
    status === "parcialmente_convertida" ||
    (approvalStatus != null &&
      PURCHASE_REQUEST_CONVERTIBLE_STATUSES_WITH_APPROVALS_DISABLED.has(
        status ?? ""
      ))
  );
}

export function isPurchaseOrderDraftLike(
  status?: string | null,
  approvalStatus?: string | null,
  approvalsEnabled = isPurchaseOrderApprovalEnabled()
) {
  if (approvalsEnabled) {
    return status === "borrador" && approvalStatus == null;
  }
  return (
    status === "borrador" ||
    (approvalStatus != null &&
      PURCHASE_ORDER_DRAFT_LIKE_STATUSES_WITH_APPROVALS_DISABLED.has(
        status ?? ""
      ))
  );
}

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

function normalizeApprovalMinimum(value: unknown) {
  return Math.max(0, roundProcurementAmount(value));
}

export function getPurchaseOrderApprovalMinimum(
  currency: PurchaseCurrency,
  settings = getRuntimeProcurementApprovalSettings()
) {
  return currency === "USD"
    ? normalizeApprovalMinimum(settings.purchaseOrderApprovalMinimumUsd)
    : normalizeApprovalMinimum(settings.purchaseOrderApprovalMinimumHnl);
}

export function purchaseOrderMeetsApprovalMinimum(
  currency: PurchaseCurrency,
  total: unknown,
  settings = getRuntimeProcurementApprovalSettings()
) {
  return (
    roundProcurementAmount(total) >=
    getPurchaseOrderApprovalMinimum(currency, settings)
  );
}

export function purchaseOrderRequiresApproval(
  currency: PurchaseCurrency,
  total: unknown,
  settings = getRuntimeProcurementApprovalSettings()
) {
  return (
    settings.purchaseOrderApprovalsEnabled &&
    purchaseOrderMeetsApprovalMinimum(currency, total, settings)
  );
}

export function formatApprovalSnapshotAmount(value: unknown) {
  return roundProcurementAmount(value).toFixed(2);
}
