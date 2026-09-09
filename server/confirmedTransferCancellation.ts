export type ConfirmedTransferCancellationItemState = {
  itemName?: string | null;
  receivedQuantity?: string | number | null;
  returnedToOriginQuantity?: string | number | null;
  receiptClosed?: boolean | null;
};

export type ConfirmedTransferCancellationRequestItemState = {
  itemName?: string | null;
  assignedFlow?: string | null;
  status?: string | null;
  deliveredQuantity?: string | number | null;
  dispatchedQuantity?: string | number | null;
};

export class ConfirmedTransferCancellationError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_STATE",
    message: string
  ) {
    super(message);
    this.name = "ConfirmedTransferCancellationError";
  }
}

export function assertConfirmedTransferCanBeCancelled(input: {
  transferStatus?: string | null;
  transferRequestStatus?: string | null;
  reverseLogisticId?: number | null;
  activeReceiptCount: number;
  items: ConfirmedTransferCancellationItemState[];
  requestItems: ConfirmedTransferCancellationRequestItemState[];
}) {
  if (input.transferStatus !== "confirmado") {
    throw new ConfirmedTransferCancellationError(
      "INVALID_STATE",
      "Solo se puede anular un traslado confirmado"
    );
  }
  if (input.transferRequestStatus !== "convertida") {
    throw new ConfirmedTransferCancellationError(
      "INVALID_STATE",
      "La solicitud vinculada ya no está en estado convertido"
    );
  }
  if (input.reverseLogisticId) {
    throw new ConfirmedTransferCancellationError(
      "INVALID_STATE",
      "Las devoluciones logísticas deben corregirse desde su propio flujo"
    );
  }
  if (input.activeReceiptCount > 0) {
    throw new ConfirmedTransferCancellationError(
      "INVALID_STATE",
      "No se puede anular porque ya existe una recepción guardada para este traslado"
    );
  }

  const processedItem = input.items.find(
    item =>
      Number(item.receivedQuantity ?? 0) > 0 ||
      Number(item.returnedToOriginQuantity ?? 0) > 0 ||
      item.receiptClosed === true
  );
  if (processedItem) {
    throw new ConfirmedTransferCancellationError(
      "INVALID_STATE",
      `${processedItem.itemName ?? "Un ítem"} ya tiene recepción, devolución o cierre registrado`
    );
  }

  const changedRequestItem = input.requestItems.find(
    item =>
      item.assignedFlow !== "traslado_proyecto" ||
      item.status !== "pendiente" ||
      Number(item.deliveredQuantity ?? 0) > 0 ||
      Number(item.dispatchedQuantity ?? 0) > 0
  );
  if (changedRequestItem) {
    throw new ConfirmedTransferCancellationError(
      "INVALID_STATE",
      `${changedRequestItem.itemName ?? "Un ítem"} ya cambió de flujo o tiene movimiento registrado`
    );
  }
}
