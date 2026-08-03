const REASSIGNMENT_BLOCKING_STATUSES = new Set(["pendiente", "en_proceso"]);

export function isSupplyFlowBlockingReassignment(
  status: string | null | undefined
) {
  return Boolean(status && REASSIGNMENT_BLOCKING_STATUSES.has(status));
}
