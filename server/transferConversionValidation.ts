export type TransferConversionDestinationItem = {
  itemName?: string | null;
  quantity: string | number;
  sourceProjectId?: number | null;
  sourceWarehouseId?: number | null;
};

export class TransferConversionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferConversionValidationError";
  }
}

export function assertValidTransferConversionDestination(input: {
  destinationType?: string | null;
  destinationProjectId?: number | null;
  destinationWarehouseId?: number | null;
  fallbackSourceProjectId?: number | null;
  items: TransferConversionDestinationItem[];
}) {
  if (input.destinationType !== "proyecto") return;

  if (!input.destinationProjectId || !input.destinationWarehouseId) {
    throw new TransferConversionValidationError(
      "Seleccione un proyecto y almacén destino antes de convertir la solicitud"
    );
  }

  const conflictingItem = input.items.find(item => {
    if (Number(item.quantity) <= 0) return false;
    const sourceProjectId =
      item.sourceProjectId === undefined
        ? (input.fallbackSourceProjectId ?? null)
        : item.sourceProjectId;

    return (
      sourceProjectId === input.destinationProjectId &&
      item.sourceWarehouseId === input.destinationWarehouseId
    );
  });

  if (!conflictingItem) return;

  const itemLabel = String(conflictingItem.itemName ?? "El ítem").trim();
  throw new TransferConversionValidationError(
    `${itemLabel || "El ítem"}: el proyecto y almacén destino no pueden ser los mismos del origen`
  );
}
