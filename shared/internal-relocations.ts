export type TransferMovementRequest = {
  projectId?: number | null;
  destinationType?: string | null;
  destinationProjectId?: number | null;
  destinationWarehouseId?: number | null;
  materialRequestId?: number | null;
  reverseLogisticId?: number | null;
  notes?: string | null;
};

export type TransferMovementLine = {
  sourceProjectId?: number | null;
  sourceWarehouseId?: number | null;
  sourceStorageLocation?: string | null;
  materialRequestItemId?: number | null;
  quantity?: number | string | null;
  itemName?: string | null;
};

export function normalizeStorageLocation(value: string | null | undefined) {
  return String(value ?? "").trim() || null;
}

export function sameStorageLocation(
  left: string | null | undefined,
  right: string | null | undefined
) {
  return (
    (normalizeStorageLocation(left)?.toLowerCase() ?? "") ===
    (normalizeStorageLocation(right)?.toLowerCase() ?? "")
  );
}

export function isSameTransferScope(
  request: TransferMovementRequest,
  line: TransferMovementLine,
  destinationWarehouseId = request.destinationWarehouseId
) {
  const sourceProjectId =
    line.sourceProjectId === undefined
      ? request.projectId
      : line.sourceProjectId;
  return Boolean(
    request.destinationType === "proyecto" &&
      sourceProjectId &&
      line.sourceWarehouseId &&
      sourceProjectId === request.destinationProjectId &&
      line.sourceWarehouseId === destinationWarehouseId
  );
}

export function isInternalRelocationLine(
  request: TransferMovementRequest,
  line: TransferMovementLine
) {
  return (
    // A missing property is not evidence of an independent request. Actual
    // requests persist this as null; requisitions and returns keep their guard.
    request.materialRequestId === null &&
    !request.reverseLogisticId &&
    !line.materialRequestItemId &&
    isSameTransferScope(request, line)
  );
}

export function getTransferMovementKind(
  request: TransferMovementRequest,
  items: readonly TransferMovementLine[]
): "internal" | "transfer" | "mixed" {
  const positiveItems = items.filter(item => Number(item.quantity ?? 1) > 0);
  const internalCount = positiveItems.filter(item =>
    isInternalRelocationLine(request, item)
  ).length;
  if (internalCount === 0) return "transfer";
  return internalCount === positiveItems.length ? "internal" : "mixed";
}

export function getInternalRelocationDestinationError(
  request: TransferMovementRequest,
  line: TransferMovementLine,
  destinationWarehouseId: number | null | undefined,
  destinationStorageLocation: string | null | undefined
) {
  if (!isInternalRelocationLine(request, line)) return null;
  if (destinationWarehouseId !== line.sourceWarehouseId) {
    return "La reubicación interna debe conservar el mismo proyecto y bodega";
  }
  if (!normalizeStorageLocation(destinationStorageLocation)) {
    return "Indique la ubicación destino de la reubicación interna";
  }
  if (
    sameStorageLocation(line.sourceStorageLocation, destinationStorageLocation)
  ) {
    return "La ubicación destino debe ser diferente de la ubicación de origen";
  }
  return null;
}

export function getInternalRelocationReason(
  request: TransferMovementRequest,
  reason?: string | null
) {
  return String(reason ?? request.notes ?? "").trim();
}
