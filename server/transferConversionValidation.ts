import {
  getInternalRelocationReason,
  getTransferMovementKind,
  isInternalRelocationLine,
} from "../shared/internal-relocations";

export type TransferConversionDestinationItem = {
  itemName?: string | null;
  quantity: string | number;
  sourceProjectId?: number | null;
  sourceWarehouseId?: number | null;
  sourceStorageLocation?: string | null;
  materialRequestItemId?: number | null;
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
  materialRequestId?: number | null;
  reverseLogisticId?: number | null;
  notes?: string | null;
  relocationReason?: string | null;
  items: TransferConversionDestinationItem[];
}) {
  if (input.destinationType !== "proyecto") return;

  if (!input.destinationProjectId || !input.destinationWarehouseId) {
    throw new TransferConversionValidationError(
      "Seleccione un proyecto y almacén destino antes de convertir la solicitud"
    );
  }

  const request = { ...input, projectId: input.fallbackSourceProjectId };
  if (getTransferMovementKind(request, input.items) === "mixed") {
    throw new TransferConversionValidationError(
      "Separe las reubicaciones internas y los traslados entre bodegas o proyectos en documentos distintos"
    );
  }

  const conflictingItem = input.items.find(item => {
    if (Number(item.quantity) <= 0) return false;
    const sourceProjectId =
      item.sourceProjectId === undefined
        ? (input.fallbackSourceProjectId ?? null)
        : item.sourceProjectId;

    const sameScope =
      sourceProjectId === input.destinationProjectId &&
      item.sourceWarehouseId === input.destinationWarehouseId;
    if (sameScope && isInternalRelocationLine(request, item)) {
      if (
        !/^\d+(?:\.\d{1,2})?$/.test(String(item.quantity).trim()) ||
        !Number.isFinite(Number(item.quantity))
      ) {
        throw new TransferConversionValidationError(
          "La cantidad a reubicar debe ser válida y tener como máximo dos decimales"
        );
      }
      if (
        getInternalRelocationReason(request, input.relocationReason).length < 3
      ) {
        throw new TransferConversionValidationError(
          "Ingrese un motivo de al menos 3 caracteres para la reubicación interna"
        );
      }
      return false;
    }
    return sameScope;
  });

  if (!conflictingItem) return;

  const itemLabel = String(conflictingItem.itemName ?? "El ítem").trim();
  throw new TransferConversionValidationError(
    `${itemLabel || "El ítem"}: el proyecto y almacén destino no pueden ser los mismos del origen`
  );
}
