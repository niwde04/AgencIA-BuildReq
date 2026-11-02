/** An authorization changes reception limits, never the original contract terms. */
export type PurchaseOrderBillingAuthorization = {
  id: number;
  purchaseOrderId: number;
  authorizedUntil: string;
  additionalInvoiceCount: number;
  originalExpectedInvoiceCount: number;
  maxInvoiceCount: number;
  maxAmount: string | null;
  usedAmount: string;
  remainingAmount: string | null;
  reason: string;
  supportAttachmentId: number;
  supportFileName: string;
  authorizedById: number;
  authorizedByName: string;
  authorizedAt: string;
  revokedAt: string | null;
  revokedById: number | null;
  revokeReason: string | null;
  isUsable: boolean;
};

export function billingToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function billingDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : billingToday(value);
  const result = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return null;
  const date = new Date(`${result}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === result
    ? result
    : null;
}

/** Money is compared in ten-thousandths, without floating point rounding. */
export function billingMoneyUnits(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text))
    throw new Error(
      "El importe debe ser positivo y tener hasta cuatro decimales"
    );
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
}

export function billingMoneyString(units: bigint) {
  return `${units / BigInt(10000)}.${String(units % BigInt(10000)).padStart(4, "0")}`;
}

export function canAuthorizePurchaseOrderBilling(
  user?: { role?: string | null; buildreqRole?: string | null } | null
) {
  if (
    user?.buildreqRole === "gerente" ||
    user?.buildreqRole === "superintendente_aprobador"
  )
    return false;
  return Boolean(
    user &&
      (user.role === "admin" || user.buildreqRole === "administracion_central")
  );
}

export function getContractBillingDecision(params: {
  contractSummary: {
    expectedInvoiceCount: number;
    registeredInvoiceCount: number;
    isExpired?: boolean;
    billingAuthorization?: PurchaseOrderBillingAuthorization | null;
  };
  contractEndDate?: string | Date | null;
  documentDate?: string | Date | null;
  receiptAmount?: string | number;
  now?: Date;
}) {
  const summary = params.contractSummary;
  const end = billingDate(params.contractEndDate);
  const date = billingDate(params.documentDate);
  const today = billingToday(params.now);
  const result = (
    error: string | null,
    requiresAuthorization = false,
    authorizationId: number | null = null
  ) => ({ allowed: !error, error, requiresAuthorization, authorizationId });
  if (params.documentDate && !date)
    return result("La fecha del documento es inválida");
  if (summary.expectedInvoiceCount <= 0 || !end)
    return result(
      "La OC de contrato no tiene una programación de pagos válida"
    );
  const countExceeded =
    summary.registeredInvoiceCount >= summary.expectedInvoiceCount;
  const dateExceeded = Boolean(date && date > end);
  if (!date && (today > end || countExceeded))
    return result(
      "Ingrese la fecha real del documento para validar la recepción del contrato"
    );
  if (!countExceeded && !dateExceeded) return result(null);
  const auth = summary.billingAuthorization;
  if (
    !auth ||
    auth.revokedAt ||
    !auth.isUsable ||
    auth.authorizedUntil < today
  ) {
    return result(
      countExceeded
        ? "La OC de contrato ya alcanzó el total de facturas programadas"
        : "La fecha del documento fiscal es posterior al vencimiento del contrato",
      true
    );
  }
  if (!date || date > auth.authorizedUntil)
    return result(
      "La fecha del documento supera la fecha límite de la autorización",
      true
    );
  if (summary.registeredInvoiceCount >= auth.maxInvoiceCount)
    return result("La OC ya alcanzó el cupo de facturas autorizado", true);
  if (
    params.receiptAmount !== undefined &&
    auth.maxAmount !== null &&
    billingMoneyUnits(auth.usedAmount) +
      billingMoneyUnits(params.receiptAmount) >
      billingMoneyUnits(auth.maxAmount)
  )
    return result(
      "El importe de la recepción supera el saldo de la autorización",
      true
    );
  return result(null, true, auth.id);
}
