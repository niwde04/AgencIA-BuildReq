import { isPurchaseOrderNonInventoryLine } from "@shared/receipt-inventory";

export type ReceiptCorrectionAuditRow = {
  receiptId: number;
  receiptNumber: string;
  replacementReceiptId: number | null;
  replacementReceiptNumber: string | null;
  replacementReceiptStatus: string | null;
  projectId: number | null;
  receiptItemId: number;
  sourceItemId: number | null;
  sapItemCode: string | null;
  quantityReceived: string;
  warehouseId: number | null;
  storageLocation: string | null;
  fixedAssetSapItemCode: string | null;
  receiptItemIsFixedAsset: boolean;
  sourceCurrentSapItemCode: string | null;
  sourceOriginalSapItemCode: string | null;
  sourceIsFixedAsset: boolean | null;
  sourceFixedAssetArticleId: number | null;
  catalogTipoArticulo: number | null;
};

export type ReceiptCorrectionInventoryRow = {
  id: number;
  sapItemCode: string | null;
  projectId: number | null;
  warehouseId: number | null;
  storageLocation: string | null;
  currentStock: string;
  updatedAt: Date | string;
};

export type ReceiptCorrectionCandidateLine = {
  receiptId: number;
  receiptNumber: string;
  replacementReceiptId: number;
  replacementReceiptNumber: string;
  replacementReceiptStatus: string;
  receiptItemId: number;
  sourceItemId: number | null;
  sapItemCode: string;
  projectId: number;
  warehouseId: number;
  storageLocation: string | null;
  quantity: string;
  fixedAssetSapItemCode: string;
};

export type ReceiptCorrectionRepairUpdate = {
  inventoryItemId: number;
  sapItemCode: string;
  projectId: number;
  warehouseId: number;
  storageLocation: string | null;
  currentStockBefore: string;
  skippedReversalQuantity: string;
  currentStockAfter: string;
  expectedUpdatedAt: string;
  sourceLines: ReceiptCorrectionCandidateLine[];
};

export type ReceiptCorrectionRepairException = {
  code:
    | "missing_inventory_key"
    | "missing_replacement"
    | "ambiguous_inventory_rows"
    | "inventory_row_not_found"
    | "insufficient_current_stock";
  message: string;
  sourceLines: Array<
    | ReceiptCorrectionCandidateLine
    | Pick<
        ReceiptCorrectionAuditRow,
        "receiptId" | "receiptNumber" | "receiptItemId"
      >
  >;
  inventoryItemIds?: number[];
};

export type ReceiptCorrectionRepairPlan = {
  candidateLines: ReceiptCorrectionCandidateLine[];
  plannedUpdates: ReceiptCorrectionRepairUpdate[];
  exceptions: ReceiptCorrectionRepairException[];
};

function decimalToHundredths(value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Cantidad decimal inválida: ${value}`);
  }
  return Math.round(parsed * 100);
}

function hundredthsToDecimal(value: number) {
  return (value / 100).toFixed(2);
}

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeLocation(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function inventoryKey(params: {
  sapItemCode: string;
  projectId: number;
  warehouseId: number;
  storageLocation: string | null;
}) {
  return [
    normalizeCode(params.sapItemCode),
    params.projectId,
    params.warehouseId,
    normalizeLocation(params.storageLocation),
  ].join("|");
}

export function isSkippedReceiptInventoryReversal(
  row: ReceiptCorrectionAuditRow
) {
  if (!row.fixedAssetSapItemCode?.trim()) return false;
  if (decimalToHundredths(row.quantityReceived) <= 0) return false;

  const sapItemCode =
    row.sapItemCode ??
    row.sourceCurrentSapItemCode ??
    row.sourceOriginalSapItemCode;

  return !isPurchaseOrderNonInventoryLine({
    item: {
      isFixedAsset: row.receiptItemIsFixedAsset,
    },
    sourceItem: {
      currentSapItemCode: row.sourceCurrentSapItemCode,
      originalSapItemCode: row.sourceOriginalSapItemCode,
      sapItemCode,
      isFixedAsset: row.sourceIsFixedAsset,
      fixedAssetArticleId: row.sourceFixedAssetArticleId,
      tipoArticulo: row.catalogTipoArticulo,
    },
    catalogItem: {
      itemCode: sapItemCode,
      tipoArticulo: row.catalogTipoArticulo,
    },
  });
}

export function buildReceiptInventoryCorrectionPlan(
  auditRows: ReceiptCorrectionAuditRow[],
  inventoryRows: ReceiptCorrectionInventoryRow[]
): ReceiptCorrectionRepairPlan {
  const candidateLines: ReceiptCorrectionCandidateLine[] = [];
  const exceptions: ReceiptCorrectionRepairException[] = [];

  for (const row of auditRows) {
    if (!isSkippedReceiptInventoryReversal(row)) continue;

    const sapItemCode = normalizeCode(
      row.sapItemCode ??
        row.sourceCurrentSapItemCode ??
        row.sourceOriginalSapItemCode
    );
    if (!sapItemCode || !row.projectId || !row.warehouseId) {
      exceptions.push({
        code: "missing_inventory_key",
        message: `${row.receiptNumber} línea ${row.receiptItemId} no tiene una clave completa de inventario.`,
        sourceLines: [row],
      });
      continue;
    }
    if (
      !row.replacementReceiptId ||
      !row.replacementReceiptNumber ||
      !row.replacementReceiptStatus
    ) {
      exceptions.push({
        code: "missing_replacement",
        message: `${row.receiptNumber} línea ${row.receiptItemId} no tiene una recepción reemplazo válida.`,
        sourceLines: [row],
      });
      continue;
    }

    candidateLines.push({
      receiptId: row.receiptId,
      receiptNumber: row.receiptNumber,
      replacementReceiptId: row.replacementReceiptId,
      replacementReceiptNumber: row.replacementReceiptNumber,
      replacementReceiptStatus: row.replacementReceiptStatus,
      receiptItemId: row.receiptItemId,
      sourceItemId: row.sourceItemId,
      sapItemCode,
      projectId: row.projectId,
      warehouseId: row.warehouseId,
      storageLocation: row.storageLocation?.trim() || null,
      quantity: hundredthsToDecimal(
        decimalToHundredths(row.quantityReceived)
      ),
      fixedAssetSapItemCode: row.fixedAssetSapItemCode!.trim(),
    });
  }

  const candidateGroups = new Map<string, ReceiptCorrectionCandidateLine[]>();
  for (const line of candidateLines) {
    const key = inventoryKey(line);
    const current = candidateGroups.get(key) ?? [];
    current.push(line);
    candidateGroups.set(key, current);
  }

  const inventoryByKey = new Map<string, ReceiptCorrectionInventoryRow[]>();
  for (const row of inventoryRows) {
    const sapItemCode = normalizeCode(row.sapItemCode);
    if (!sapItemCode || !row.projectId || !row.warehouseId) continue;
    const key = inventoryKey({
      sapItemCode,
      projectId: row.projectId,
      warehouseId: row.warehouseId,
      storageLocation: row.storageLocation,
    });
    const current = inventoryByKey.get(key) ?? [];
    current.push(row);
    inventoryByKey.set(key, current);
  }

  const plannedUpdates: ReceiptCorrectionRepairUpdate[] = [];
  for (const [key, lines] of Array.from(candidateGroups.entries())) {
    const matchingRows = inventoryByKey.get(key) ?? [];
    if (matchingRows.length === 0) {
      exceptions.push({
        code: "inventory_row_not_found",
        message: `No existe saldo para ${lines[0].sapItemCode} en la ubicación original de ${lines[0].receiptNumber}.`,
        sourceLines: lines,
      });
      continue;
    }
    if (matchingRows.length > 1) {
      exceptions.push({
        code: "ambiguous_inventory_rows",
        message: `Hay ${matchingRows.length} filas de saldo para ${lines[0].sapItemCode} en la misma ubicación.`,
        sourceLines: lines,
        inventoryItemIds: matchingRows.map(row => row.id),
      });
      continue;
    }

    const inventoryRow = matchingRows[0];
    const currentStock = decimalToHundredths(inventoryRow.currentStock);
    const skippedReversal = lines.reduce(
      (total, line) => total + decimalToHundredths(line.quantity),
      0
    );
    if (currentStock < skippedReversal) {
      exceptions.push({
        code: "insufficient_current_stock",
        message: `El saldo actual de ${lines[0].sapItemCode} (${hundredthsToDecimal(
          currentStock
        )}) no cubre la reversión omitida (${hundredthsToDecimal(
          skippedReversal
        )}).`,
        sourceLines: lines,
        inventoryItemIds: [inventoryRow.id],
      });
      continue;
    }

    plannedUpdates.push({
      inventoryItemId: inventoryRow.id,
      sapItemCode: lines[0].sapItemCode,
      projectId: lines[0].projectId,
      warehouseId: lines[0].warehouseId,
      storageLocation: lines[0].storageLocation,
      currentStockBefore: hundredthsToDecimal(currentStock),
      skippedReversalQuantity: hundredthsToDecimal(skippedReversal),
      currentStockAfter: hundredthsToDecimal(currentStock - skippedReversal),
      expectedUpdatedAt: new Date(inventoryRow.updatedAt).toISOString(),
      sourceLines: lines,
    });
  }

  plannedUpdates.sort(
    (left, right) => left.inventoryItemId - right.inventoryItemId
  );
  exceptions.sort((left, right) =>
    left.message.localeCompare(right.message, "es")
  );

  return {
    candidateLines,
    plannedUpdates,
    exceptions,
  };
}
