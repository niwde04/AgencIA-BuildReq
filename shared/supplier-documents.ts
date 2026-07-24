export const SUPPLIER_ACCOUNT_PAYMENT_CERTIFICATE_CODES = [
  "constancia_pago_a_cuenta",
  "constancia_pagos_a_cuenta",
  "constancia_de_pago_a_cuenta",
  "constancia_de_pagos_a_cuenta",
] as const;

export const ACCOUNT_PAYMENT_ALLOWED_RETENTION_TAX_CODE = "RT15";
export const ACCOUNT_PAYMENT_ALLOWED_RETENTION_RATE_PERCENT = 15;
export const MISSING_CPC_REQUIRED_RETENTION_TAX_CODE = "RT01";
export const MISSING_CPC_REQUIRED_RETENTION_RATE_PERCENT = 1;

export type SupplierAccountPaymentCertificateStatus =
  | "vigente"
  | "vencido"
  | "futuro"
  | "sin_vencimiento";
export type SupplierRetentionPolicy = "rt15_only" | "manual" | "none";

const SUPPLIER_ACCOUNT_PAYMENT_CERTIFICATE_CODE_SET = new Set<string>(
  SUPPLIER_ACCOUNT_PAYMENT_CERTIFICATE_CODES
);

export function normalizeSupplierDocumentTypeCode(value?: string | null) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isSupplierAccountPaymentCertificateCode(value?: string | null) {
  return SUPPLIER_ACCOUNT_PAYMENT_CERTIFICATE_CODE_SET.has(
    normalizeSupplierDocumentTypeCode(value)
  );
}

function getDateOnlyKey(value?: string | Date | null): number | null {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return Number(`${match[1]}${match[2]}${match[3]}`);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
  );
}

export function getSupplierAccountPaymentCertificateStatus(
  value: {
    documentDate?: string | Date | null;
    expirationDate?: string | Date | null;
  },
  referenceDate: string | Date = new Date()
): SupplierAccountPaymentCertificateStatus {
  const referenceKey = getDateOnlyKey(referenceDate);
  const documentKey = getDateOnlyKey(value.documentDate);
  const expirationKey = getDateOnlyKey(value.expirationDate);

  if (!expirationKey) return "sin_vencimiento";
  if (referenceKey && documentKey && documentKey > referenceKey)
    return "futuro";
  if (referenceKey && expirationKey < referenceKey) return "vencido";
  return "vigente";
}

export function isAccountPaymentAllowedRetention(value: {
  taxCode?: string | null;
  ratePercent?: string | number | null;
}) {
  const taxCode = String(value.taxCode ?? "")
    .trim()
    .toUpperCase();
  const ratePercent = Number(value.ratePercent);
  return (
    taxCode === ACCOUNT_PAYMENT_ALLOWED_RETENTION_TAX_CODE &&
    Number.isFinite(ratePercent) &&
    Math.abs(ratePercent - ACCOUNT_PAYMENT_ALLOWED_RETENTION_RATE_PERCENT) <
      0.000001
  );
}

export function isMissingCpcRequiredRetention(value: {
  taxCode?: string | null;
  ratePercent?: string | number | null;
}) {
  const taxCode = String(value.taxCode ?? "")
    .trim()
    .toUpperCase();
  const ratePercent = Number(value.ratePercent);
  return (
    taxCode === MISSING_CPC_REQUIRED_RETENTION_TAX_CODE &&
    Number.isFinite(ratePercent) &&
    Math.abs(ratePercent - MISSING_CPC_REQUIRED_RETENTION_RATE_PERCENT) <
      0.000001
  );
}

export function getSupplierRetentionPolicy(value: {
  certificateStatus?: SupplierAccountPaymentCertificateStatus | null;
  allowsTaxWithholding?: boolean | null;
}): SupplierRetentionPolicy {
  if (value.certificateStatus === "vigente") return "rt15_only";
  return value.allowsTaxWithholding !== false ? "manual" : "none";
}

export function getEffectiveSupplierFiscalProfile(value: {
  certificateStatus?: SupplierAccountPaymentCertificateStatus | null;
  allowsTaxWithholding?: boolean | null;
  subjectToAccountPayments?: boolean | null;
}) {
  if (value.certificateStatus === "vigente") {
    return {
      allowsTaxWithholding: false,
      subjectToAccountPayments: true,
    };
  }

  return {
    allowsTaxWithholding: value.allowsTaxWithholding !== false,
    subjectToAccountPayments: value.subjectToAccountPayments !== false,
  };
}
