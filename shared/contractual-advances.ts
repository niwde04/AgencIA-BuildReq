import { decimalToMinorUnits, roundDecimalAmount } from "./money";

export type AdvanceApplicationMode = "direct" | "contractual" | "legacy_manual";
export type AdvanceAmortizationTreatment = Exclude<
  AdvanceApplicationMode,
  "direct"
>;
export type AmortizationMode = "percentage" | "amount";
export type AmortizationBase = "subtotal" | "total";
export type ContractualAdvanceRule = {
  amortizationMode: AmortizationMode;
  amortizationValue: string | number;
  amortizationBase: AmortizationBase;
};

export function proposeContractualAmortization(
  input: ContractualAdvanceRule & {
    subtotal: string | number;
    total: string | number;
    remainingAmount: string | number;
  }
) {
  const baseAmount = Number(input[input.amortizationBase]);
  const requested =
    input.amortizationMode === "percentage"
      ? (baseAmount * Number(input.amortizationValue)) / 100
      : Number(input.amortizationValue);
  const amount =
    Math.max(
      0,
      Math.min(
        decimalToMinorUnits(requested),
        decimalToMinorUnits(input.remainingAmount),
        decimalToMinorUnits(baseAmount)
      )
    ) / 100;
  return {
    baseAmount,
    amount,
    remainingAmount: roundDecimalAmount(input.remainingAmount, 2),
  };
}

export function contractualAmortizationAmount(input: {
  baseAmount: number;
  inputMode: AmortizationMode;
  inputValue: number;
  remainingAmount: number;
  proposedAmount: number;
  overrideReason?: string | null;
  requireOverrideReason?: boolean;
}) {
  if (
    !Number.isFinite(input.inputValue) ||
    input.inputValue < 0 ||
    (input.inputMode === "percentage" && input.inputValue > 100)
  ) {
    throw new Error(
      "La amortización debe ser positiva o cero; el porcentaje no puede exceder 100%."
    );
  }
  const amount = roundDecimalAmount(
    input.inputMode === "percentage"
      ? (input.baseAmount * input.inputValue) / 100
      : input.inputValue,
    2
  );
  if (
    decimalToMinorUnits(amount) > decimalToMinorUnits(input.remainingAmount) ||
    decimalToMinorUnits(amount) > decimalToMinorUnits(input.baseAmount)
  ) {
    throw new Error(
      "La amortización supera el saldo disponible del anticipo o la base de la factura. Actualice y revise el importe."
    );
  }
  if (
    input.requireOverrideReason !== false &&
    decimalToMinorUnits(amount) !== decimalToMinorUnits(input.proposedAmount) &&
    (input.overrideReason?.trim().length ?? 0) < 5
  ) {
    throw new Error(
      "Indique el motivo del ajuste de amortización (mínimo 5 caracteres)."
    );
  }
  return amount;
}

/** Paid balance, excluding the current invoice's consumption so its saved amount remains valid. */
export function legacyManualRemainingAmount(input: {
  covered: string | number;
  applied: string | number;
  ownApplied: string | number;
  unconsumedCommitments: string | number;
}) {
  return (
    Math.max(
      0,
      decimalToMinorUnits(input.covered) -
        decimalToMinorUnits(input.applied) +
        decimalToMinorUnits(input.ownApplied) -
        decimalToMinorUnits(input.unconsumedCommitments)
    ) / 100
  );
}
