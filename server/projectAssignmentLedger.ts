import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  invoiceItems,
  invoices,
  materialRequests,
  projectSubprojects,
  reverseLogistics,
  reverseLogisticsItems,
  sapCatalog,
  suppliers,
  warehouseExitItems,
  warehouseExits,
} from "../drizzle/schema";
import { getDb } from "./db";

export type AssignmentTargetType =
  | "subproyecto"
  | "activo_fijo"
  | "sin_destino";

export type AssignmentTargetSortBy =
  | "destino"
  | "estado"
  | "articulos"
  | "movimientos"
  | "ultima_asignacion";
export type AssignmentTargetSortDirection = "asc" | "desc";

export type AssignmentTarget = {
  targetType: AssignmentTargetType;
  targetKey: string;
  code: string;
  name: string;
  isActive: boolean;
  isHistorical: boolean;
  articleCount: number;
  movementCount: number;
  lastAssignmentAt: Date | null;
};

export type AssignmentSummaryRow = {
  sapItemCode: string;
  itemName: string;
  unit: string;
  deliveredQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  purchasedHnl: number;
  purchasedUsd: number;
  purchaseInvoices: AccountedPurchaseInvoice[];
};

export type AccountedPurchaseInvoice = {
  invoiceId: number;
  invoiceDocumentNumber: string;
  fiscalInvoiceNumber: string | null;
  documentDate: Date | null;
  accountedAt: Date;
  supplierName: string | null;
  currency: "HNL" | "USD";
  lineTotal: number;
};

export type AssignmentMovement = {
  movementId: string;
  movementType: "salida" | "devolucion";
  movementDate: Date;
  warehouseExitId: number;
  warehouseExitNumber: string;
  returnId: number | null;
  returnNumber: string | null;
  requestId: number | null;
  requestNumber: string | null;
  sapItemCode: string;
  itemName: string;
  unit: string;
  deliveredQuantity: number;
  returnedQuantity: number;
  netQuantity: number;
  receivedByName: string | null;
  targetType: AssignmentTargetType;
  targetKey: string;
};

export type RawAssignmentExitLine = {
  exitItemId: number;
  warehouseExitId: number;
  warehouseExitNumber: string;
  exitDate: Date;
  emittedAt: Date | null;
  exitReceivedByName: string | null;
  requestId: number | null;
  requestNumber: string | null;
  sapItemCode: string;
  itemName: string;
  unit: string | null;
  quantity: string | number;
  targetType: "subproyecto" | "activo_fijo" | null;
  subProjectId: number | null;
  fixedAssetSapItemCode: string | null;
  fixedAssetName: string | null;
  status: "borrador" | "emitida" | "anulada";
};

export type RawAssignmentReturnLine = {
  returnItemId: number;
  sourceWarehouseExitItemId: number | null;
  returnId: number;
  returnNumber: string;
  processedAt: Date | null;
  createdAt: Date;
  receivedByName: string | null;
  quantity: string | number;
  status: string;
};

export type RawAccountedPurchaseLine = {
  invoiceItemId: number;
  invoiceId: number;
  invoiceDocumentNumber: string;
  fiscalInvoiceNumber: string | null;
  documentDate: Date | null;
  supplierName: string | null;
  sapItemCode: string | null;
  itemName: string;
  unit: string | null;
  total: string | number;
  currency: "HNL" | "USD";
  targetType: "subproyecto" | "activo_fijo" | null;
  subProjectId: number | null;
  fixedAssetSapItemCode: string | null;
  status: string;
  accountedAt: Date | null;
};

type ConfiguredSubproject = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
};

type ConfiguredFixedAsset = {
  itemCode: string;
  description: string;
  isActive: boolean;
};

type Snapshot = {
  targets: AssignmentTarget[];
  summariesByTargetId: Map<string, AssignmentSummaryRow[]>;
  movementsByTargetId: Map<string, AssignmentMovement[]>;
};

const NO_TARGET_KEY = "sin_destino";

function normalizeFixedAssetKey(value: string) {
  return value.trim().toLocaleUpperCase("es-HN");
}

function getTargetIdentity(
  line: Pick<
    RawAssignmentExitLine,
    "targetType" | "subProjectId" | "fixedAssetSapItemCode"
  >
) {
  if (line.targetType === "subproyecto" && line.subProjectId) {
    return {
      targetType: "subproyecto" as const,
      targetKey: String(line.subProjectId),
    };
  }
  if (line.targetType === "activo_fijo" && line.fixedAssetSapItemCode?.trim()) {
    return {
      targetType: "activo_fijo" as const,
      targetKey: normalizeFixedAssetKey(line.fixedAssetSapItemCode),
    };
  }
  return {
    targetType: "sin_destino" as const,
    targetKey: NO_TARGET_KEY,
  };
}

function getTargetId(targetType: AssignmentTargetType, targetKey: string) {
  return `${targetType}:${targetKey}`;
}

function parseQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSummaryId(
  row: Pick<AssignmentSummaryRow, "sapItemCode" | "itemName" | "unit">
) {
  return [row.sapItemCode, row.itemName, row.unit].join("\u001f");
}

function movementTimestamp(movement: AssignmentMovement) {
  const value = movement.movementDate.getTime();
  return Number.isFinite(value) ? value : 0;
}

export function buildProjectAssignmentSnapshot(params: {
  subprojects: ConfiguredSubproject[];
  fixedAssets: ConfiguredFixedAsset[];
  exitLines: RawAssignmentExitLine[];
  returnLines: RawAssignmentReturnLine[];
  purchaseLines: RawAccountedPurchaseLine[];
}): Snapshot {
  const targetDefinitions = new Map<
    string,
    Omit<
      AssignmentTarget,
      "articleCount" | "movementCount" | "lastAssignmentAt"
    >
  >();

  for (const subproject of params.subprojects) {
    const targetKey = String(subproject.id);
    targetDefinitions.set(getTargetId("subproyecto", targetKey), {
      targetType: "subproyecto",
      targetKey,
      code: subproject.code,
      name: subproject.name,
      isActive: subproject.isActive,
      isHistorical: false,
    });
  }

  for (const fixedAsset of params.fixedAssets) {
    const targetKey = normalizeFixedAssetKey(fixedAsset.itemCode);
    targetDefinitions.set(getTargetId("activo_fijo", targetKey), {
      targetType: "activo_fijo",
      targetKey,
      code: fixedAsset.itemCode,
      name: fixedAsset.description,
      isActive: fixedAsset.isActive,
      isHistorical: false,
    });
  }

  const emittedExitLines = params.exitLines.filter(
    line => line.status === "emitida"
  );
  const exitLineById = new Map(
    emittedExitLines.map(line => [line.exitItemId, line])
  );
  const movementsByTargetId = new Map<string, AssignmentMovement[]>();

  function addMovement(movement: AssignmentMovement) {
    const targetId = getTargetId(movement.targetType, movement.targetKey);
    const current = movementsByTargetId.get(targetId) ?? [];
    current.push(movement);
    movementsByTargetId.set(targetId, current);
  }

  for (const line of emittedExitLines) {
    const target = getTargetIdentity(line);
    const targetId = getTargetId(target.targetType, target.targetKey);
    if (!targetDefinitions.has(targetId)) {
      if (target.targetType === "subproyecto") {
        targetDefinitions.set(targetId, {
          ...target,
          code: `Subproyecto #${target.targetKey}`,
          name: "Destino histórico",
          isActive: false,
          isHistorical: true,
        });
      } else if (target.targetType === "activo_fijo") {
        targetDefinitions.set(targetId, {
          ...target,
          code: line.fixedAssetSapItemCode?.trim() || target.targetKey,
          name: line.fixedAssetName?.trim() || "Activo fijo histórico",
          isActive: false,
          isHistorical: true,
        });
      } else {
        targetDefinitions.set(targetId, {
          ...target,
          code: "-",
          name: "Sin destino definido",
          isActive: false,
          isHistorical: true,
        });
      }
    }

    const quantity = parseQuantity(line.quantity);
    addMovement({
      movementId: `salida:${line.exitItemId}`,
      movementType: "salida",
      movementDate: line.emittedAt ?? line.exitDate,
      warehouseExitId: line.warehouseExitId,
      warehouseExitNumber: line.warehouseExitNumber,
      returnId: null,
      returnNumber: null,
      requestId: line.requestId,
      requestNumber: line.requestNumber,
      sapItemCode: line.sapItemCode,
      itemName: line.itemName,
      unit: line.unit?.trim() || "-",
      deliveredQuantity: quantity,
      returnedQuantity: 0,
      netQuantity: quantity,
      receivedByName: line.exitReceivedByName,
      ...target,
    });
  }

  for (const returnLine of params.returnLines) {
    if (returnLine.status === "rechazada") continue;
    if (!returnLine.sourceWarehouseExitItemId) continue;
    const sourceLine = exitLineById.get(returnLine.sourceWarehouseExitItemId);
    if (!sourceLine) continue;

    const target = getTargetIdentity(sourceLine);
    const quantity = parseQuantity(returnLine.quantity);
    addMovement({
      movementId: `devolucion:${returnLine.returnItemId}`,
      movementType: "devolucion",
      movementDate: returnLine.processedAt ?? returnLine.createdAt,
      warehouseExitId: sourceLine.warehouseExitId,
      warehouseExitNumber: sourceLine.warehouseExitNumber,
      returnId: returnLine.returnId,
      returnNumber: returnLine.returnNumber,
      requestId: sourceLine.requestId,
      requestNumber: sourceLine.requestNumber,
      sapItemCode: sourceLine.sapItemCode,
      itemName: sourceLine.itemName,
      unit: sourceLine.unit?.trim() || "-",
      deliveredQuantity: 0,
      returnedQuantity: quantity,
      netQuantity: -quantity,
      receivedByName: returnLine.receivedByName,
      ...target,
    });
  }

  const summariesByTargetId = new Map<string, AssignmentSummaryRow[]>();
  const targets: AssignmentTarget[] = [];

  for (const [targetId, definition] of Array.from(
    targetDefinitions.entries()
  )) {
    const movements = (movementsByTargetId.get(targetId) ?? []).sort(
      (left, right) =>
        movementTimestamp(right) - movementTimestamp(left) ||
        right.movementId.localeCompare(left.movementId)
    );
    const summaries = new Map<string, AssignmentSummaryRow>();

    for (const movement of movements) {
      const summaryId = getSummaryId(movement);
      const current = summaries.get(summaryId) ?? {
        sapItemCode: movement.sapItemCode,
        itemName: movement.itemName,
        unit: movement.unit,
        deliveredQuantity: 0,
        returnedQuantity: 0,
        netQuantity: 0,
        purchasedHnl: 0,
        purchasedUsd: 0,
        purchaseInvoices: [],
      };
      current.deliveredQuantity += movement.deliveredQuantity;
      current.returnedQuantity += movement.returnedQuantity;
      current.netQuantity += movement.netQuantity;
      summaries.set(summaryId, current);
    }

    for (const purchaseLine of params.purchaseLines) {
      if (
        purchaseLine.status !== "registrada" ||
        !purchaseLine.accountedAt ||
        !purchaseLine.sapItemCode?.trim()
      ) {
        continue;
      }
      const purchaseTarget = getTargetIdentity(purchaseLine);
      if (
        getTargetId(purchaseTarget.targetType, purchaseTarget.targetKey) !==
        targetId
      ) {
        continue;
      }

      const purchaseIdentity = {
        sapItemCode: purchaseLine.sapItemCode.trim(),
        itemName: purchaseLine.itemName,
        unit: purchaseLine.unit?.trim() || "-",
      };
      let summary = summaries.get(getSummaryId(purchaseIdentity));
      if (!summary) {
        const normalizedCode = purchaseIdentity.sapItemCode.toUpperCase();
        const normalizedUnit = purchaseIdentity.unit.toLocaleLowerCase("es-HN");
        const compatibleRows = Array.from(summaries.values()).filter(
          row =>
            row.sapItemCode.trim().toUpperCase() === normalizedCode &&
            row.unit.trim().toLocaleLowerCase("es-HN") === normalizedUnit
        );
        if (compatibleRows.length === 1) {
          summary = compatibleRows[0];
        }
      }
      if (!summary) continue;

      const purchaseTotal = parseQuantity(purchaseLine.total);
      if (purchaseLine.currency === "USD") {
        summary.purchasedUsd += purchaseTotal;
      } else {
        summary.purchasedHnl += purchaseTotal;
      }
      const existingInvoice = summary.purchaseInvoices.find(
        invoice => invoice.invoiceId === purchaseLine.invoiceId
      );
      if (existingInvoice) {
        existingInvoice.lineTotal += purchaseTotal;
      } else {
        summary.purchaseInvoices.push({
          invoiceId: purchaseLine.invoiceId,
          invoiceDocumentNumber: purchaseLine.invoiceDocumentNumber,
          fiscalInvoiceNumber: purchaseLine.fiscalInvoiceNumber,
          documentDate: purchaseLine.documentDate,
          accountedAt: purchaseLine.accountedAt,
          supplierName: purchaseLine.supplierName,
          currency: purchaseLine.currency,
          lineTotal: purchaseTotal,
        });
      }
    }

    for (const summary of Array.from(summaries.values())) {
      summary.purchaseInvoices.sort(
        (left, right) =>
          right.accountedAt.getTime() - left.accountedAt.getTime() ||
          right.invoiceId - left.invoiceId
      );
    }

    const summaryRows = Array.from(summaries.values()).sort((left, right) =>
      `${left.sapItemCode} ${left.itemName} ${left.unit}`.localeCompare(
        `${right.sapItemCode} ${right.itemName} ${right.unit}`,
        "es-HN"
      )
    );
    summariesByTargetId.set(targetId, summaryRows);
    movementsByTargetId.set(targetId, movements);

    targets.push({
      ...definition,
      articleCount: summaryRows.length,
      movementCount: movements.length,
      lastAssignmentAt:
        movements.find(movement => movement.movementType === "salida")
          ?.movementDate ?? null,
    });
  }

  targets.sort((left, right) => {
    if (left.targetType === "sin_destino") return -1;
    if (right.targetType === "sin_destino") return 1;
    return `${left.code} ${left.name}`.localeCompare(
      `${right.code} ${right.name}`,
      "es-HN"
    );
  });

  return { targets, summariesByTargetId, movementsByTargetId };
}

async function loadProjectAssignmentSnapshot(projectId: number) {
  const database = await getDb();
  if (!database) throw new Error("DB not available");

  const [subprojects, fixedAssets, exitLines, purchaseLines] =
    await Promise.all([
      database
        .select({
          id: projectSubprojects.id,
          code: projectSubprojects.code,
          name: projectSubprojects.name,
          isActive: projectSubprojects.isActive,
        })
        .from(projectSubprojects)
        .where(eq(projectSubprojects.projectId, projectId)),
      database
        .select({
          itemCode: sapCatalog.itemCode,
          description: sapCatalog.description,
          isActive: sapCatalog.isActive,
        })
        .from(sapCatalog)
        .where(
          and(
            eq(sapCatalog.projectId, projectId),
            eq(sapCatalog.tipoArticulo, 3)
          )
        ),
      database
        .select({
          exitItemId: warehouseExitItems.id,
          warehouseExitId: warehouseExits.id,
          warehouseExitNumber: warehouseExits.exitNumber,
          exitDate: warehouseExits.exitDate,
          emittedAt: warehouseExits.emittedAt,
          exitReceivedByName: warehouseExits.receivedByName,
          requestId: materialRequests.id,
          requestNumber: materialRequests.requestNumber,
          sapItemCode: warehouseExitItems.sapItemCode,
          itemName: warehouseExitItems.itemName,
          unit: warehouseExitItems.unit,
          quantity: warehouseExitItems.quantity,
          targetType: warehouseExitItems.targetType,
          subProjectId: warehouseExitItems.subProjectId,
          fixedAssetSapItemCode: warehouseExitItems.fixedAssetSapItemCode,
          fixedAssetName: warehouseExitItems.fixedAssetName,
          status: warehouseExits.status,
        })
        .from(warehouseExitItems)
        .innerJoin(
          warehouseExits,
          eq(warehouseExitItems.warehouseExitId, warehouseExits.id)
        )
        .leftJoin(
          materialRequests,
          eq(warehouseExits.materialRequestId, materialRequests.id)
        )
        .where(
          and(
            eq(warehouseExits.status, "emitida"),
            sql`coalesce(${materialRequests.projectId}, ${warehouseExits.projectId}) = ${projectId}`
          )
        ),
      database
        .select({
          invoiceItemId: invoiceItems.id,
          invoiceId: invoices.id,
          invoiceDocumentNumber: invoices.invoiceDocumentNumber,
          fiscalInvoiceNumber: invoices.invoiceNumber,
          documentDate: invoices.documentDate,
          supplierName: suppliers.name,
          sapItemCode: sql<
            string | null
          >`coalesce(${invoiceItems.currentSapItemCode}, ${invoiceItems.originalSapItemCode})`,
          itemName: invoiceItems.itemName,
          unit: invoiceItems.unit,
          total: invoiceItems.total,
          currency: invoices.currency,
          targetType: invoiceItems.targetType,
          subProjectId: invoiceItems.subProjectId,
          fixedAssetSapItemCode: invoiceItems.fixedAssetSapItemCode,
          status: invoices.status,
          accountedAt: invoices.accountedAt,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
        .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
        .where(
          and(
            eq(invoices.projectId, projectId),
            eq(invoices.status, "registrada"),
            isNotNull(invoices.accountedAt)
          )
        ),
    ]);

  const exitItemIds = exitLines.map(line => line.exitItemId);
  const returnLines =
    exitItemIds.length === 0
      ? []
      : await database
          .select({
            returnItemId: reverseLogisticsItems.id,
            sourceWarehouseExitItemId:
              reverseLogisticsItems.sourceWarehouseExitItemId,
            returnId: reverseLogistics.id,
            returnNumber: reverseLogistics.returnNumber,
            processedAt: reverseLogistics.processedAt,
            createdAt: reverseLogistics.createdAt,
            receivedByName: reverseLogistics.receivedByName,
            quantity: reverseLogisticsItems.quantity,
            status: reverseLogistics.status,
          })
          .from(reverseLogisticsItems)
          .innerJoin(
            reverseLogistics,
            eq(reverseLogisticsItems.reverseLogisticId, reverseLogistics.id)
          )
          .where(
            and(
              inArray(
                reverseLogisticsItems.sourceWarehouseExitItemId,
                exitItemIds
              ),
              sql`${reverseLogistics.status} <> 'rechazada'`
            )
          );

  return buildProjectAssignmentSnapshot({
    subprojects,
    fixedAssets,
    exitLines,
    returnLines,
    purchaseLines,
  });
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    page: currentPage,
    pageSize,
    total,
    totalPages,
  };
}

function getTargetStatusRank(target: AssignmentTarget) {
  if (target.articleCount === 0) return 3;
  if (target.targetType === "sin_destino") return 1;
  return target.isActive ? 0 : 2;
}

export function sortAssignmentTargets(
  rows: AssignmentTarget[],
  sortBy: AssignmentTargetSortBy,
  direction: AssignmentTargetSortDirection
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    let comparison = 0;
    if (sortBy === "destino") {
      comparison = `${left.code} ${left.name}`.localeCompare(
        `${right.code} ${right.name}`,
        "es-HN",
        { numeric: true, sensitivity: "base" }
      );
    } else if (sortBy === "estado") {
      comparison = getTargetStatusRank(left) - getTargetStatusRank(right);
    } else if (sortBy === "articulos") {
      comparison = left.articleCount - right.articleCount;
    } else if (sortBy === "movimientos") {
      comparison = left.movementCount - right.movementCount;
    } else {
      if (!left.lastAssignmentAt && !right.lastAssignmentAt) comparison = 0;
      else if (!left.lastAssignmentAt) return 1;
      else if (!right.lastAssignmentAt) return -1;
      else {
        comparison =
          left.lastAssignmentAt.getTime() - right.lastAssignmentAt.getTime();
      }
    }

    if (comparison !== 0) return comparison * directionMultiplier;
    return `${left.code} ${left.name}`.localeCompare(
      `${right.code} ${right.name}`,
      "es-HN",
      { numeric: true, sensitivity: "base" }
    );
  });
}

export async function listProjectAssignmentTargets(params: {
  projectId: number;
  targetType: "subproyecto" | "activo_fijo";
  search?: string;
  page: number;
  pageSize: number;
  sortBy?: AssignmentTargetSortBy;
  sortDirection?: AssignmentTargetSortDirection;
}) {
  const snapshot = await loadProjectAssignmentSnapshot(params.projectId);
  const normalizedSearch = params.search?.trim().toLocaleLowerCase("es-HN");
  const targets = snapshot.targets.filter(target => {
    const matchesType =
      target.targetType === params.targetType ||
      (params.targetType === "subproyecto" &&
        target.targetType === "sin_destino");
    if (!matchesType) return false;
    if (!normalizedSearch) return true;
    return `${target.code} ${target.name}`
      .toLocaleLowerCase("es-HN")
      .includes(normalizedSearch);
  });
  const sortedTargets = sortAssignmentTargets(
    targets,
    params.sortBy ?? "destino",
    params.sortDirection ?? "asc"
  );
  return paginate(sortedTargets, params.page, params.pageSize);
}

export async function getProjectAssignmentLedger(params: {
  projectId: number;
  targetType: AssignmentTargetType;
  targetKey: string;
  historyPage: number;
  historyPageSize: number;
}) {
  const snapshot = await loadProjectAssignmentSnapshot(params.projectId);
  const normalizedTargetKey =
    params.targetType === "activo_fijo"
      ? normalizeFixedAssetKey(params.targetKey)
      : params.targetKey;
  const targetId = getTargetId(params.targetType, normalizedTargetKey);
  const target = snapshot.targets.find(
    row => getTargetId(row.targetType, row.targetKey) === targetId
  );
  if (!target) return null;

  return {
    target,
    summary: snapshot.summariesByTargetId.get(targetId) ?? [],
    movements: paginate(
      snapshot.movementsByTargetId.get(targetId) ?? [],
      params.historyPage,
      params.historyPageSize
    ),
  };
}

export async function exportProjectAssignmentLedger(params: {
  projectId: number;
  targetType: AssignmentTargetType;
  targetKey: string;
}) {
  const snapshot = await loadProjectAssignmentSnapshot(params.projectId);
  const normalizedTargetKey =
    params.targetType === "activo_fijo"
      ? normalizeFixedAssetKey(params.targetKey)
      : params.targetKey;
  const targetId = getTargetId(params.targetType, normalizedTargetKey);
  const target = snapshot.targets.find(
    row => getTargetId(row.targetType, row.targetKey) === targetId
  );
  if (!target) return null;

  return {
    target,
    summary: snapshot.summariesByTargetId.get(targetId) ?? [],
    movements: snapshot.movementsByTargetId.get(targetId) ?? [],
  };
}
