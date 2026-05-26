const CAI_GROUPS = [6, 6, 6, 6, 6, 2] as const;
const INVOICE_NUMBER_GROUPS = [3, 3, 2, 8] as const;

export const CAI_FORMAT_EXAMPLE = "338827-15203E-A419E0-63BE03-0909A6-53";
export const INVOICE_NUMBER_FORMAT_EXAMPLE = "000-001-01-00010571";
export const FISCAL_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  "01": "Factura",
  "02": "Factura Prevalorada",
  "03": "Ticket",
  "04": "Recibo por Honorarios Profesionales",
  "05": "Boleta de Compra",
  "08": "Constancia de Donación",
  "09": "Nota de Crédito",
  "10": "Nota de Débito",
  "11": "Guía de Remisión",
};
export const EMISSION_DEADLINE_ISSUE_MESSAGE =
  "Documento fuera de fecha límite de emisión";

const CAI_LENGTH = CAI_GROUPS.reduce((sum, group) => sum + group, 0);
const INVOICE_NUMBER_LENGTH = INVOICE_NUMBER_GROUPS.reduce(
  (sum, group) => sum + group,
  0
);

function formatByGroups(value: string, groups: readonly number[]) {
  const parts: string[] = [];
  let offset = 0;

  for (const groupLength of groups) {
    const part = value.slice(offset, offset + groupLength);
    if (!part) break;
    parts.push(part);
    offset += groupLength;
  }

  return parts.join("-");
}

export function formatCaiInput(value: string | null | undefined) {
  const compact = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CAI_LENGTH);

  return formatByGroups(compact, CAI_GROUPS);
}

export function formatInvoiceNumberInput(value: string | null | undefined) {
  const compact = String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, INVOICE_NUMBER_LENGTH);

  return formatByGroups(compact, INVOICE_NUMBER_GROUPS);
}

export function isValidCai(value: string | null | undefined) {
  const compact = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (compact.length !== CAI_LENGTH) return false;

  return /^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{2}$/.test(
    formatByGroups(compact, CAI_GROUPS)
  );
}

export function isValidInvoiceNumber(value: string | null | undefined) {
  const compact = String(value ?? "").replace(/\D/g, "");
  if (compact.length !== INVOICE_NUMBER_LENGTH) return false;

  return /^\d{3}-\d{3}-\d{2}-\d{8}$/.test(
    formatByGroups(compact, INVOICE_NUMBER_GROUPS)
  );
}

export function getDocumentTypeCodeFromNumber(
  value: string | null | undefined
) {
  const compact = String(value ?? "").replace(/\D/g, "");
  return compact.length >= 8 ? compact.slice(6, 8) : null;
}

export function getDocumentTypeLabelFromNumber(
  value: string | null | undefined
) {
  const code = getDocumentTypeCodeFromNumber(value);
  if (!code) return null;
  return FISCAL_DOCUMENT_TYPE_LABELS[code] ?? `Tipo ${code}`;
}

function getDateOnlyKey(value: string | Date | null | undefined) {
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

export function hasEmissionDeadlineIssue(value: {
  isFiscalDocument?: boolean | null;
  documentDate?: string | Date | null;
  emissionDeadline?: string | Date | null;
}) {
  if (!value.isFiscalDocument) return false;
  const documentDate = getDateOnlyKey(value.documentDate);
  const emissionDeadline = getDateOnlyKey(value.emissionDeadline);
  return Boolean(
    documentDate && emissionDeadline && documentDate > emissionDeadline
  );
}
