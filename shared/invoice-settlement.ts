import { decimalToMinorUnits, type DecimalValue } from "./money";

export const DOCUMENT_CENTS_POLICY = "document_cents_v1" as const;
export type InvoiceSettlementPolicy = "legacy" | typeof DOCUMENT_CENTS_POLICY;
export type InvoiceSettlementInput = {
  policy?: InvoiceSettlementPolicy | string | null;
  total?: DecimalValue;
  retentionTotal?: DecimalValue;
  otherRetentionTotal?: DecimalValue;
  documentDiscountTotal?: DecimalValue;
  creditNoteTotal?: DecimalValue;
  debitNoteTotal?: DecimalValue;
  netPayable: DecimalValue;
};
export type InvoiceSettlement = {
  policy: InvoiceSettlementPolicy;
  amount: number;
  originalNetPayable: number;
  difference: number;
};

/** Receipts/documents retain four decimals. Only the amount to settle uses cents. */
export function calculateInvoiceSettlement(
  input: InvoiceSettlementInput
): InvoiceSettlement {
  const originalUnits = decimalToMinorUnits(input.netPayable, 4);
  const oldCents = decimalToMinorUnits(input.netPayable, 2);
  const policy: InvoiceSettlementPolicy =
    input.policy === DOCUMENT_CENTS_POLICY ? DOCUMENT_CENTS_POLICY : "legacy";
  const cents =
    policy === "legacy"
      ? oldCents
      : Math.max(
          0,
          decimalToMinorUnits(input.total, 2) -
            decimalToMinorUnits(input.retentionTotal, 2) -
            decimalToMinorUnits(input.otherRetentionTotal, 2) -
            decimalToMinorUnits(input.documentDiscountTotal, 2) -
            decimalToMinorUnits(input.creditNoteTotal, 2) +
            decimalToMinorUnits(input.debitNoteTotal, 2)
        );
  return {
    policy,
    amount: cents / 100,
    originalNetPayable: originalUnits / 10000,
    difference: (cents - oldCents) / 100,
  };
}

/** Maintenance/backend guard; previews may intentionally contain incomplete edits. */
export function assertInvoiceSettlementOriginals(
  input: InvoiceSettlementInput
) {
  const values = [
    input.total,
    input.retentionTotal,
    input.otherRetentionTotal,
    input.documentDiscountTotal,
    input.creditNoteTotal,
    input.debitNoteTotal,
    input.netPayable,
  ];
  if (
    values.some(
      v =>
        v == null ||
        !/^[+-]?\d+(?:\.\d+)?$/.test(String(v)) ||
        !Number.isFinite(Number(v))
    )
  )
    throw new Error(
      "Los importes originales de la factura no son válidos para liquidar."
    );
  const original = decimalToMinorUnits(input.netPayable, 4);
  const expected =
    decimalToMinorUnits(input.total, 4) -
    decimalToMinorUnits(input.retentionTotal, 4) -
    decimalToMinorUnits(input.otherRetentionTotal, 4) -
    decimalToMinorUnits(input.documentDiscountTotal, 4) -
    decimalToMinorUnits(input.creditNoteTotal, 4) +
    decimalToMinorUnits(input.debitNoteTotal, 4);
  if (original < 0 || original !== expected)
    throw new Error(
      "El neto original no coincide con sus conceptos; revise la factura antes de liquidarla."
    );
}
