import type { TreasuryBatchStatus, TreasuryItemStatus } from "@shared/treasury";

const SETTLED_TREASURY_ITEM_STATUSES = new Set<TreasuryItemStatus>([
  "pagada",
  "con_diferencia",
  "contabilizada",
]);

export function isTreasuryItemBlockingInvoiceReview(input: {
  batchStatus: TreasuryBatchStatus;
  itemStatus: TreasuryItemStatus;
  activeReservation: boolean;
}) {
  if (SETTLED_TREASURY_ITEM_STATUSES.has(input.itemStatus)) return true;
  if (input.batchStatus === "anulado") return false;

  return input.activeReservation;
}
