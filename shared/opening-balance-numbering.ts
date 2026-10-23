// Issued folios retired by an audited correction must never be issued again.
// Keep this list aligned with ob_no_retired_balance_number in the database.
export const RETIRED_OPENING_BALANCE_NUMBERS = ["SI-024-00000001"] as const;

export function isRetiredOpeningBalanceNumber(value: string) {
  return RETIRED_OPENING_BALANCE_NUMBERS.some(number => number === value);
}
