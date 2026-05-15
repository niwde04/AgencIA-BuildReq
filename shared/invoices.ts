const CAI_GROUPS = [6, 6, 6, 6, 6, 2] as const;
const INVOICE_NUMBER_GROUPS = [3, 3, 2, 8] as const;

export const CAI_FORMAT_EXAMPLE = "338827-15203E-A419E0-63BE03-0909A6-53";
export const INVOICE_NUMBER_FORMAT_EXAMPLE = "000-001-01-00010571";

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
