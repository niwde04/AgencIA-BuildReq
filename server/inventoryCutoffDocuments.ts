import type {
  InventoryCutoffEntryRow,
  InventoryCutoffExitRow,
} from "../shared/inventory-cutoff-report";
import type {
  InventoryCutoffSources,
  InventoryCutoffGrainSource,
} from "./inventoryCutoffSources";
import {
  hondurasDate,
  type CutoffMovement,
} from "./inventoryCutoffReconstruction";

export type ReportMovement = CutoffMovement & {
  entry?: InventoryCutoffEntryRow;
  exit?: InventoryCutoffExitRow;
};

export function projectLabel(
  code: string | null | undefined,
  name: string | null | undefined,
  id?: number | null
) {
  return (
    [code, name].filter(Boolean).join(" - ") ||
    (id ? `Proyecto ${id}` : "Sin proyecto")
  );
}

function targetLabel(row: {
  fixedAssetCode?: string | null;
  fixedAssetName?: string | null;
  subprojectCode?: string | null;
  subprojectName?: string | null;
}) {
  return (
    [row.fixedAssetCode, row.fixedAssetName].filter(Boolean).join(" - ") ||
    [row.subprojectCode, row.subprojectName].filter(Boolean).join(" - ")
  );
}

function grain(row: InventoryCutoffGrainSource) {
  return {
    sapItemCode: row.sapItemCode?.trim() ?? "",
    itemName: row.itemName,
    unit: row.unit,
    projectId: row.projectId,
    warehouseId: row.warehouseId,
    storageLocation: row.storageLocation,
  };
}

function entry(
  row: InventoryCutoffGrainSource,
  number: string,
  at: string,
  documentType: string,
  quantity: string
): InventoryCutoffEntryRow {
  return {
    receiptNumber: number,
    invoiceDate: "",
    invoiceNumber: "",
    entryDate: hondurasDate(at),
    projectLabel: projectLabel(row.projectCode, row.projectName, row.projectId),
    warehouseLabel: row.warehouseLabel ?? "Sin almacén registrado",
    documentType,
    destination: "",
    sapItemCode: row.sapItemCode ?? "",
    itemName: row.itemName,
    brand: "",
    partNumber: "",
    unit: row.unit ?? "",
    quantity: Number(quantity),
    storageLocation: row.storageLocation ?? "Sin ubicación",
    observations: "",
  };
}

function exit(
  row: InventoryCutoffGrainSource,
  number: string,
  at: string,
  quantity: string
): InventoryCutoffExitRow {
  return {
    exitNumber: number,
    exitDate: hondurasDate(at),
    ownerProjectLabel: projectLabel(
      row.projectCode,
      row.projectName,
      row.projectId
    ),
    requestingProjectLabel: "",
    warehouseLabel: row.warehouseLabel ?? "Sin almacén registrado",
    destination: "",
    sapItemCode: row.sapItemCode ?? "",
    itemName: row.itemName,
    unit: row.unit ?? "",
    quantity: Number(quantity),
    reference: "",
    storageLocation: row.storageLocation ?? "Sin ubicación",
    observations: "",
  };
}

/** Dates bound actual registration evidence, not a supplier's invoice date. */
export function buildCutoffDocumentMovements(
  sources: InventoryCutoffSources
): ReportMovement[] {
  const result: ReportMovement[] = [];
  for (const row of sources.openingLines) {
    result.push({
      ...grain(row),
      id: `opening:${row.openingItemId}`,
      at: row.recordedAt,
      quantity: row.quantity,
      direction: 1,
      locationKnown: true,
      entry: {
        ...entry(
          row,
          row.documentNumber,
          row.recordedAt,
          "Saldo inicial",
          row.quantity
        ),
        observations: `Apertura registrada. Fecha documental: ${hondurasDate(row.effectiveAt)}.`,
      },
    });
  }
  for (const row of sources.receiptLines) {
    if (row.classification === "non_inventory") continue;
    const common = {
      ...grain(row),
      quantity: row.quantity,
      at: row.recordedAt,
      uncertain:
        row.classification === "unknown" ||
        row.sourceLineMissing ||
        !row.sapItemCode,
    };
    const received = {
      ...entry(
        row,
        row.documentNumber,
        row.recordedAt,
        row.sourceType === "transfer"
          ? "Traslado"
          : row.isFiscalDocument
            ? "Factura"
            : "Recepción",
        row.quantity
      ),
      invoiceDate: row.documentDate ? hondurasDate(row.documentDate) : "",
      invoiceNumber: row.invoiceNumber ?? "",
      destination: targetLabel(row),
      brand: row.brand ?? "",
      partNumber: row.partNumber ?? "",
      observations: `Ingreso registrado. Fecha operativa: ${hondurasDate(row.effectiveAt)}.${common.uncertain ? " Fuente de inventario incompleta." : ""}`,
    };
    result.push({
      ...common,
      id: `receipt:${row.receiptItemId}:in`,
      direction: 1,
      locationKnown: true,
      entry: received,
    });
    if (row.sourceType === "transfer") {
      const source: InventoryCutoffGrainSource = {
        ...row,
        projectId: row.sourceProjectId,
        projectCode: row.sourceProjectCode,
        projectName: row.sourceProjectName,
        warehouseId: row.sourceWarehouseId,
        warehouseLabel: row.sourceWarehouseLabel,
        storageLocation: row.sourceStorageLocation,
      };
      result.push({
        ...common,
        ...grain(source),
        id: `receipt:${row.receiptItemId}:out`,
        direction: -1,
        locationKnown: !row.sourceLineMissing,
        exit: {
          ...exit(source, row.documentNumber, row.recordedAt, row.quantity),
          destination: [
            received.projectLabel,
            received.warehouseLabel,
            received.storageLocation,
          ]
            .filter(Boolean)
            .join(" / "),
          reference: `Traslado: recepción ${row.documentNumber}`,
          observations:
            "Salida física del traslado por la cantidad recibida; no se cuenta otra vez su confirmación.",
        },
      });
    }
    if (row.voidedAt && row.sourceType === "purchase_order") {
      result.push({
        ...common,
        id: `receipt:${row.receiptItemId}:void`,
        at: row.voidedAt,
        direction: -1,
        locationKnown: true,
        exit: {
          ...exit(row, row.documentNumber, row.voidedAt, row.quantity),
          reference: `Anulación de recepción ${row.documentNumber}`,
          observations:
            "Reverso físico en la fecha de anulación; conserva el ingreso original en cortes anteriores.",
        },
      });
    }
  }
  for (const row of sources.exitLines) {
    if (row.status !== "emitida" || !row.recordedAt) continue;
    result.push({
      ...grain(row),
      id: `exit:${row.exitItemId}`,
      at: row.recordedAt,
      quantity: row.quantity,
      direction: -1,
      locationKnown: row.locationKnown,
      exit: {
        ...exit(row, row.documentNumber, row.recordedAt, row.quantity),
        requestingProjectLabel: row.requestProjectId
          ? projectLabel(
              row.requestProjectCode,
              row.requestProjectName,
              row.requestProjectId
            )
          : "",
        destination: [
          row.destinationProjectId
            ? projectLabel(
                row.destinationProjectCode,
                row.destinationProjectName,
                row.destinationProjectId
              )
            : "",
          row.destinationWarehouseLabel,
          targetLabel(row),
        ]
          .filter(Boolean)
          .join(" / "),
        reference:
          row.lineNotes ||
          row.headerNotes ||
          row.requestNumber ||
          row.documentNumber,
        storageLocation: row.locationKnown
          ? (row.storageLocation ?? "Sin ubicación")
          : "Ubicación histórica no registrada",
        observations: row.locationKnown
          ? `Salida emitida. Fecha operativa: ${hondurasDate(row.effectiveAt)}.`
          : "El documento no registra de qué ubicación se consumió; no se asignó un estante por suposición.",
      },
    });
  }
  for (const row of sources.returnLines) {
    if (row.returnType === "devolucion_bodega_proyecto") {
      if (!row.sourceExitLinkValid && row.status !== "recibida") continue;
      const at = row.sourceExitLinkValid ? row.recordedAt : row.processedAt;
      if (!at) continue;
      result.push({
        ...grain(row),
        id: `return:${row.returnItemId}:in`,
        at,
        quantity: row.quantity,
        direction: 1,
        locationKnown: row.locationKnown,
        uncertain: !row.sourceExitLinkValid,
        entry: {
          ...entry(
            row,
            row.documentNumber,
            at,
            "Devolución a bodega",
            row.quantity
          ),
          storageLocation: row.locationKnown
            ? (row.storageLocation ?? "Sin ubicación")
            : "Ubicación histórica no registrada",
          observations: row.sourceExitLinkValid
            ? "Devolución vinculada a la salida de origen."
            : "No se conserva la asignación de ubicación de esta devolución.",
        },
      });
    } else if (row.returnType === "devolucion_proveedor" && row.noteCreatedAt) {
      result.push({
        ...grain(row),
        id: `return:${row.returnItemId}:out`,
        at: row.noteCreatedAt,
        quantity: row.quantity,
        direction: -1,
        locationKnown: false,
        exit: {
          ...exit(row, row.documentNumber, row.noteCreatedAt, row.quantity),
          reference:
            row.lineNotes ||
            row.headerNotes ||
            row.sourceReceiptNumber ||
            row.documentNumber,
          storageLocation: "Ubicación histórica no registrada",
          observations:
            "Devolución a proveedor registrada con su nota vinculada; ubicación consumida no registrada.",
        },
      });
    }
    // Returns implemented through a transfer are already represented by receipt legs.
  }
  return result;
}
