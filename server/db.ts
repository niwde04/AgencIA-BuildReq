import {
  eq,
  and,
  desc,
  asc,
  sql,
  count,
  ilike,
  or,
  inArray,
  isNotNull,
  gte,
  lte,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import {
  InsertUser,
  User,
  users,
  userProjectAssignments,
  warehouseUserAssignments,
  projectWarehouseAssignments,
  projects,
  projectSubprojects,
  materialRequests,
  requestItems,
  supplyFlowRecords,
  purchaseRequests,
  purchaseRequestItems,
  purchaseOrders,
  purchaseOrderAuditLogs,
  purchaseOrderItems,
  transferRequests,
  transferRequestItems,
  transfers,
  remissionGuides,
  receipts,
  receiptItems,
  receiptOtherCharges,
  invoices,
  invoiceItems,
  invoiceOtherCharges,
  invoiceRetentions,
  salesTaxes,
  taxRetentions,
  warehouseExits,
  warehouseExitItems,
  openingBalances,
  openingBalanceItems,
  reverseLogistics,
  reverseLogisticsItems,
  attachments,
  notifications,
  inventoryItems,
  sapSyncLog,
  invitations,
  invitationProjectAssignments,
  sapCatalog,
  suppliers,
  supplierFiscalDocumentRanges,
  supplierContacts,
  supplierDocumentTypes,
  supplierDocuments,
  warehouses,
} from "../drizzle/schema";
import type {
  InsertProject,
  InsertProjectSubproject,
  ProjectSubproject,
  InsertMaterialRequest,
  InsertRequestItem,
  InsertSupplyFlowRecord,
  InsertPurchaseRequest,
  InsertPurchaseRequestItem,
  InsertPurchaseOrder,
  InsertPurchaseOrderAuditLog,
  InsertPurchaseOrderItem,
  InsertTransferRequest,
  InsertTransferRequestItem,
  InsertTransfer,
  InsertRemissionGuide,
  InsertReceipt,
  InsertReceiptItem,
  InsertReceiptOtherCharge,
  InsertInvoice,
  InsertInvoiceItem,
  InsertInvoiceOtherCharge,
  InsertInvoiceRetention,
  InsertSalesTax,
  InsertTaxRetention,
  InsertWarehouseExit,
  InsertWarehouseExitItem,
  InsertOpeningBalance,
  InsertOpeningBalanceItem,
  InsertReverseLogistic,
  InsertReverseLogisticItem,
  InsertAttachment,
  InsertNotification,
  InsertInventoryItem,
  InventoryItem,
  InsertSapSyncLogEntry,
  Invitation,
  InsertInvitation,
  InsertSapCatalogItem,
  InsertSupplier,
  InsertSupplierFiscalDocumentRange,
  Invoice,
  Supplier,
  InsertSupplierContact,
  InsertSupplierDocumentType,
  InsertSupplierDocument,
  SupplierDocumentType,
  SupplierDocument,
  Attachment,
  InsertWarehouse,
  Warehouse,
  OpeningBalance,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  buildEmailPreview,
  buildProcurementPdfBase64,
  buildPurchaseOrderPrintPdfBase64,
  buildSimplePdfBase64,
} from "./_core/documents";
import {
  calculatePurchaseOrderLineAmounts,
  DEFAULT_SALES_TAXES,
  formatPurchaseOrderCurrency,
  getPurchaseOrderContractSummary,
  getPurchaseOrderFiscalSummaryRows,
  getPurchaseOrderTaxSelectionError,
  normalizePurchaseOrderTaxCode,
  parsePurchaseOrderAdditionalTaxCodes,
  summarizePurchaseOrderLines,
  type PurchaseOrderTaxBreakdownEntry,
  type SalesTaxCatalogItem,
} from "@shared/purchase-orders";
import {
  normalizeFixedAssetDetails,
  type FixedAssetDetail,
} from "@shared/fixed-assets";
import {
  getDemoImportWorkload,
  type ParsedDemoImportPayload,
} from "./_core/demoData";
import {
  buildSupplierExcelImportAnalysis,
  parseSupplierExcelWorkbook,
  summarizeSupplierExcelImportAnalysis,
  type SupplierExcelFileInput,
} from "./_core/supplierExcelImport";
import {
  formatCaiInput,
  formatInvoiceNumberInput,
  getFiscalInvoiceNumberKey,
  isFiscalInvoiceRangeOrdered,
  isValidCai,
  isValidInvoiceNumber,
  normalizeFiscalRtn,
} from "@shared/invoices";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export type BuildReqRole =
  | "ingeniero_residente"
  | "jefe_bodega_central"
  | "administracion_central"
  | "administrador_proyecto"
  | "bodeguero_proyecto"
  | "superintendente"
  | "contable";

type AttachmentEntityType =
  | "material_request"
  | "supply_flow"
  | "reverse_logistic"
  | "purchase_request"
  | "purchase_order"
  | "transfer_request"
  | "transfer"
  | "receipt"
  | "invoice"
  | "supplier";

function parseDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const normalized = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function toDecimalString(value: string | number | null | undefined) {
  return parseDecimal(value).toFixed(2);
}

function toMoneyString4(value: string | number | null | undefined) {
  return parseDecimal(value).toFixed(4);
}

function toRateString(value: string | number | null | undefined) {
  return parseDecimal(value).toFixed(4);
}

function roundMoney(value: string | number | null | undefined) {
  return Math.round((parseDecimal(value) + Number.EPSILON) * 10000) / 10000;
}

function getPendingConversionQuantity(item: {
  quantity: string | number | null | undefined;
  convertedQuantity?: string | number | null | undefined;
}) {
  return Math.max(
    parseDecimal(item.quantity) - parseDecimal(item.convertedQuantity),
    0
  );
}

function getWarehouseExitPendingQuantityForRequestItem(item: {
  quantity: string | number | null | undefined;
  deliveredQuantity?: string | number | null | undefined;
  dispatchedQuantity?: string | number | null | undefined;
  assignedFlow?: string | null | undefined;
}) {
  const requestedQuantity = Math.max(parseDecimal(item.quantity), 0);
  const alreadyDispatched = Math.max(parseDecimal(item.dispatchedQuantity), 0);
  const receivedQuantity = Math.min(
    Math.max(parseDecimal(item.deliveredQuantity), 0),
    requestedQuantity
  );
  const dispatchableQuantity =
    item.assignedFlow === "despacho_bodega"
      ? requestedQuantity
      : receivedQuantity;

  return Math.max(dispatchableQuantity - alreadyDispatched, 0);
}

function getOpenQuantity(item: {
  quantity: string | number | null | undefined;
  receivedQuantity?: string | number | null | undefined;
  receiptClosed?: boolean | null | undefined;
}) {
  if (item.receiptClosed) return 0;
  return Math.max(
    parseDecimal(item.quantity) - parseDecimal(item.receivedQuantity),
    0
  );
}

function getPurchaseOrderReceiptStatus(
  items: Array<{
    quantity: string | number | null | undefined;
    receivedQuantity?: string | number | null | undefined;
    receiptClosed?: boolean | null | undefined;
  }>
) {
  if (items.length === 0) {
    return "emitida" as const;
  }

  const allResolved = items.every(item => getOpenQuantity(item) <= 0);
  if (allResolved) {
    return "recibida" as const;
  }

  const hasProgress = items.some(
    item => item.receiptClosed || parseDecimal(item.receivedQuantity) > 0
  );

  return hasProgress
    ? ("parcialmente_recibida" as const)
    : ("emitida" as const);
}

function getTransferOpenQuantity(item: {
  quantity: string | number | null | undefined;
  receivedQuantity?: string | number | null | undefined;
  returnedToOriginQuantity?: string | number | null | undefined;
  receiptClosed?: boolean | null | undefined;
}) {
  if (item.receiptClosed) return 0;
  return Math.max(
    parseDecimal(item.quantity) -
      parseDecimal(item.receivedQuantity) -
      parseDecimal(item.returnedToOriginQuantity),
    0
  );
}

function getTransferReceiptStatus(
  items: Array<{
    quantity: string | number | null | undefined;
    receivedQuantity?: string | number | null | undefined;
    returnedToOriginQuantity?: string | number | null | undefined;
    receiptClosed?: boolean | null | undefined;
  }>
) {
  if (items.length === 0) {
    return "confirmado" as const;
  }

  const allResolved = items.every(item => getTransferOpenQuantity(item) <= 0);
  const hasReturnedToOrigin = items.some(
    item =>
      item.receiptClosed || parseDecimal(item.returnedToOriginQuantity) > 0
  );

  if (allResolved) {
    return hasReturnedToOrigin
      ? ("cerrado_incompleto" as const)
      : ("recibido" as const);
  }

  const hasProgress = items.some(
    item =>
      parseDecimal(item.receivedQuantity) > 0 ||
      parseDecimal(item.returnedToOriginQuantity) > 0 ||
      Boolean(item.receiptClosed)
  );

  return hasProgress
    ? ("parcialmente_recibido" as const)
    : ("confirmado" as const);
}

type PurchaseHistoryReference = {
  unitPrice: string;
  supplierId: number | null;
  supplierCode: string | null;
  supplierName: string | null;
  orderNumber: string | null;
  purchasedAt: Date | null;
};

type SapProcurementInsight = {
  sapDescription: string | null;
  lastPurchase: PurchaseHistoryReference | null;
  minimumPurchase: PurchaseHistoryReference | null;
};

async function getSapProcurementInsightsByCodes(sapCodes: string[]) {
  const db = await getDb();
  const normalizedCodes = Array.from(
    new Set(
      sapCodes
        .map(code => code?.trim())
        .filter((code): code is string => Boolean(code))
    )
  );

  const emptyInsights = Object.fromEntries(
    normalizedCodes.map(code => [
      code,
      {
        sapDescription: null,
        lastPurchase: null,
        minimumPurchase: null,
      } satisfies SapProcurementInsight,
    ])
  ) as Record<string, SapProcurementInsight>;

  if (!db || normalizedCodes.length === 0) {
    return emptyInsights;
  }

  const [catalogRows, inventoryRows, purchaseRows] = await Promise.all([
    db
      .select({
        sapItemCode: sapCatalog.itemCode,
        description: sapCatalog.description,
      })
      .from(sapCatalog)
      .where(
        and(
          eq(sapCatalog.isActive, true),
          inArray(sapCatalog.itemCode, normalizedCodes)
        )
      ),
    db
      .select({
        sapItemCode: inventoryItems.sapItemCode,
        description: inventoryItems.description,
        name: inventoryItems.name,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.sapItemCode, normalizedCodes))
      .orderBy(desc(inventoryItems.updatedAt)),
    db
      .select({
        currentSapItemCode: purchaseOrderItems.currentSapItemCode,
        originalSapItemCode: purchaseOrderItems.originalSapItemCode,
        unitPrice: purchaseOrderItems.unitPrice,
        orderNumber: purchaseOrders.orderNumber,
        purchasedAt: purchaseOrders.createdAt,
        supplierId: purchaseOrders.supplierId,
        supplierCode: suppliers.supplierCode,
        supplierName: suppliers.name,
      })
      .from(purchaseOrderItems)
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)
      )
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          sql`${purchaseOrders.status} NOT IN ('borrador', 'anulada')`,
          sql`${purchaseOrderItems.unitPrice} > 0`,
          or(
            and(
              isNotNull(purchaseOrderItems.currentSapItemCode),
              inArray(purchaseOrderItems.currentSapItemCode, normalizedCodes)
            ),
            and(
              isNotNull(purchaseOrderItems.originalSapItemCode),
              inArray(purchaseOrderItems.originalSapItemCode, normalizedCodes)
            )
          )
        )
      )
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrderItems.id)),
  ]);

  for (const row of catalogRows) {
    if (!emptyInsights[row.sapItemCode]) continue;
    emptyInsights[row.sapItemCode].sapDescription =
      row.description?.trim() || null;
  }

  for (const row of inventoryRows) {
    if (!emptyInsights[row.sapItemCode]) continue;
    if (emptyInsights[row.sapItemCode].sapDescription) continue;
    emptyInsights[row.sapItemCode].sapDescription =
      row.description?.trim() || row.name?.trim() || null;
  }

  const sapCodeSet = new Set(normalizedCodes);

  for (const row of purchaseRows) {
    const matchedCodes = [
      row.currentSapItemCode?.trim(),
      row.originalSapItemCode?.trim(),
    ].filter((code, index, values): code is string => {
      if (!code) return false;
      if (!sapCodeSet.has(code)) return false;
      return values.indexOf(code) === index;
    });

    if (matchedCodes.length === 0) continue;

    const reference: PurchaseHistoryReference = {
      unitPrice: toMoneyString4(row.unitPrice),
      supplierId: row.supplierId ?? null,
      supplierCode: row.supplierCode ?? null,
      supplierName: row.supplierName ?? null,
      orderNumber: row.orderNumber ?? null,
      purchasedAt: row.purchasedAt ?? null,
    };

    for (const code of matchedCodes) {
      const insight = emptyInsights[code];
      if (!insight) continue;

      if (!insight.lastPurchase) {
        insight.lastPurchase = reference;
      }

      if (
        !insight.minimumPurchase ||
        parseDecimal(reference.unitPrice) <
          parseDecimal(insight.minimumPurchase.unitPrice)
      ) {
        insight.minimumPurchase = reference;
      }
    }
  }

  return emptyInsights;
}

export async function getLatestSupplierPurchasePrices(params: {
  supplierId: number;
  sapCodes: string[];
  projectId?: number;
  projectIds?: number[];
}) {
  const db = await getDb();
  const normalizedCodes = Array.from(
    new Set(
      params.sapCodes
        .map(code => code?.trim())
        .filter((code): code is string => Boolean(code))
    )
  );

  if (!db || normalizedCodes.length === 0) {
    return {} as Record<string, PurchaseHistoryReference>;
  }

  const conditions = [
    eq(purchaseOrders.supplierId, params.supplierId),
    sql`${purchaseOrders.status} NOT IN ('borrador', 'anulada')`,
    sql`${purchaseOrderItems.unitPrice} > 0`,
    or(
      and(
        isNotNull(purchaseOrderItems.currentSapItemCode),
        inArray(purchaseOrderItems.currentSapItemCode, normalizedCodes)
      ),
      and(
        isNotNull(purchaseOrderItems.originalSapItemCode),
        inArray(purchaseOrderItems.originalSapItemCode, normalizedCodes)
      )
    ),
  ];

  if (params.projectId) {
    conditions.push(eq(purchaseOrders.projectId, params.projectId));
  } else if (params.projectIds) {
    applyProjectScope(conditions, purchaseOrders.projectId, params.projectIds);
  }

  const rows = await db
    .select({
      currentSapItemCode: purchaseOrderItems.currentSapItemCode,
      originalSapItemCode: purchaseOrderItems.originalSapItemCode,
      unitPrice: purchaseOrderItems.unitPrice,
      orderNumber: purchaseOrders.orderNumber,
      purchasedAt: purchaseOrders.createdAt,
      supplierId: purchaseOrders.supplierId,
      supplierCode: suppliers.supplierCode,
      supplierName: suppliers.name,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)
    )
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrderItems.id));

  const result = {} as Record<string, PurchaseHistoryReference>;
  const sapCodeSet = new Set(normalizedCodes);

  for (const row of rows) {
    const matchedCodes = [
      row.currentSapItemCode?.trim(),
      row.originalSapItemCode?.trim(),
    ].filter((code, index, values): code is string => {
      if (!code) return false;
      if (!sapCodeSet.has(code)) return false;
      return values.indexOf(code) === index;
    });

    if (matchedCodes.length === 0) continue;

    const reference: PurchaseHistoryReference = {
      unitPrice: toMoneyString4(row.unitPrice),
      supplierId: row.supplierId ?? null,
      supplierCode: row.supplierCode ?? null,
      supplierName: row.supplierName ?? null,
      orderNumber: row.orderNumber ?? null,
      purchasedAt: row.purchasedAt ?? null,
    };

    for (const code of matchedCodes) {
      if (!result[code]) {
        result[code] = reference;
      }
    }
  }

  return result;
}

function formatDateLabel(date: Date | string | null | undefined) {
  if (!date) return "Sin fecha";
  return new Date(date).toLocaleDateString("es-HN");
}

function formatPrintDateLabel(date: Date | string | null | undefined) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPrintNumberLabel(value: string | number | null | undefined) {
  const parsed = parseDecimal(value);
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatPrintMoneyLabel(value: string | number | null | undefined) {
  return parseDecimal(value).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildPurchaseOrderSummaryRows(
  items: Array<{
    quantity: string | number | null | undefined;
    unitPrice?: string | number | null;
    taxCode?: string | null;
  }>
) {
  const summary = summarizePurchaseOrderLines(items);
  return [
    {
      label: "Subtotal",
      value: formatPurchaseOrderCurrency(summary.subtotal),
    },
    {
      label: "Total exento",
      value: formatPurchaseOrderCurrency(summary.totalExempt),
    },
    {
      label: "Total ISV",
      value: formatPurchaseOrderCurrency(summary.totalIsv),
    },
    {
      label: "Total",
      value: formatPurchaseOrderCurrency(summary.total),
      emphasized: true,
    },
  ];
}

// ============================================================
// USERS
// ============================================================
function normalizeProjectIds(
  projectIds?: Array<number | null | undefined> | null
) {
  if (!Array.isArray(projectIds)) return [];
  return Array.from(
    new Set(
      projectIds
        .map(projectId => Number(projectId))
        .filter(
          (projectId): projectId is number =>
            Number.isInteger(projectId) && projectId > 0
        )
    )
  );
}

const WAREHOUSE_ASSIGNABLE_ROLES: BuildReqRole[] = [
  "administracion_central",
  "jefe_bodega_central",
  "administrador_proyecto",
  "bodeguero_proyecto",
];

const PROJECT_SCOPED_WAREHOUSE_USER_ROLES: BuildReqRole[] = [
  "administrador_proyecto",
  "bodeguero_proyecto",
];

const WAREHOUSE_ASSIGNMENT_SOURCE_MANUAL = "manual";
const WAREHOUSE_ASSIGNMENT_SOURCE_PROJECT_SCOPE = "project_scope";

function isWarehouseAssignableUser(user?: Pick<User, "buildreqRole"> | null) {
  return Boolean(
    user?.buildreqRole &&
      WAREHOUSE_ASSIGNABLE_ROLES.includes(user.buildreqRole as BuildReqRole)
  );
}

function isProjectScopedWarehouseUserRole(role?: string | null) {
  return Boolean(
    role && PROJECT_SCOPED_WAREHOUSE_USER_ROLES.includes(role as BuildReqRole)
  );
}

type ProjectScopedWarehouseAssignment = {
  id: number;
  warehouseId: number;
  assignmentSource?: string | null;
  isResponsible?: boolean | null;
};

export function calculateProjectScopedWarehouseAssignmentChanges(params: {
  buildreqRole?: string | null;
  projectWarehouseIds: number[];
  existingAssignments: ProjectScopedWarehouseAssignment[];
}) {
  const desiredWarehouseIds = isProjectScopedWarehouseUserRole(
    params.buildreqRole
  )
    ? normalizeProjectIds(params.projectWarehouseIds)
    : [];
  const desiredWarehouseIdSet = new Set(desiredWarehouseIds);
  const existingWarehouseIds = new Set(
    params.existingAssignments.map(assignment => Number(assignment.warehouseId))
  );

  return {
    warehouseIdsToInsert: desiredWarehouseIds.filter(
      warehouseId => !existingWarehouseIds.has(warehouseId)
    ),
    assignmentIdsToDelete: params.existingAssignments
      .filter(
        assignment =>
          assignment.assignmentSource ===
            WAREHOUSE_ASSIGNMENT_SOURCE_PROJECT_SCOPE &&
          !assignment.isResponsible &&
          !desiredWarehouseIdSet.has(Number(assignment.warehouseId))
      )
      .map(assignment => Number(assignment.id)),
  };
}

function mapWarehouseAssignedUser(row: {
  assignment: typeof warehouseUserAssignments.$inferSelect;
  user: User;
}) {
  return {
    assignmentId: row.assignment.id,
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.user.role,
    buildreqRole: row.user.buildreqRole,
    isResponsible: row.assignment.isResponsible,
    assignmentSource: row.assignment.assignmentSource,
    assignedById: row.assignment.assignedById,
    assignedAt: row.assignment.createdAt,
  };
}

async function replaceUserProjectAssignmentsForUser(
  userId: number,
  projectIds?: number[] | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const normalizedProjectIds = normalizeProjectIds(projectIds);
  await db
    .delete(userProjectAssignments)
    .where(eq(userProjectAssignments.userId, userId));

  if (normalizedProjectIds.length > 0) {
    await db.insert(userProjectAssignments).values(
      normalizedProjectIds.map(projectId => ({
        userId,
        projectId,
      }))
    );
  }
}

export async function syncUserWarehouseAssignmentsFromProjects(params: {
  userId: number;
  buildreqRole?: string | null;
  projectIds?: number[] | null;
  assignedById?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const normalizedProjectIds = normalizeProjectIds(params.projectIds);
  const projectWarehouseRows =
    isProjectScopedWarehouseUserRole(params.buildreqRole) &&
    normalizedProjectIds.length > 0
      ? await db
          .select({ warehouseId: projectWarehouseAssignments.warehouseId })
          .from(projectWarehouseAssignments)
          .innerJoin(
            warehouses,
            eq(projectWarehouseAssignments.warehouseId, warehouses.id)
          )
          .where(
            and(
              inArray(
                projectWarehouseAssignments.projectId,
                normalizedProjectIds
              ),
              eq(warehouses.isActive, true)
            )
          )
      : [];
  const projectWarehouseIds = normalizeProjectIds(
    projectWarehouseRows.map(row => row.warehouseId)
  );

  const existingAssignments = await db
    .select({
      id: warehouseUserAssignments.id,
      warehouseId: warehouseUserAssignments.warehouseId,
      assignmentSource: warehouseUserAssignments.assignmentSource,
      isResponsible: warehouseUserAssignments.isResponsible,
    })
    .from(warehouseUserAssignments)
    .where(eq(warehouseUserAssignments.userId, params.userId));

  const { warehouseIdsToInsert, assignmentIdsToDelete } =
    calculateProjectScopedWarehouseAssignmentChanges({
      buildreqRole: params.buildreqRole,
      projectWarehouseIds,
      existingAssignments,
    });

  if (warehouseIdsToInsert.length === 0 && assignmentIdsToDelete.length === 0) {
    return {
      success: true,
      insertedRows: 0,
      deletedRows: 0,
    };
  }

  await db.transaction(async tx => {
    if (assignmentIdsToDelete.length > 0) {
      await tx
        .delete(warehouseUserAssignments)
        .where(inArray(warehouseUserAssignments.id, assignmentIdsToDelete));
    }

    if (warehouseIdsToInsert.length > 0) {
      await tx
        .insert(warehouseUserAssignments)
        .values(
          warehouseIdsToInsert.map(warehouseId => ({
            warehouseId,
            userId: params.userId,
            isResponsible: false,
            assignmentSource: WAREHOUSE_ASSIGNMENT_SOURCE_PROJECT_SCOPE,
            assignedById: params.assignedById ?? null,
          }))
        )
        .onConflictDoNothing();
    }
  });

  return {
    success: true,
    insertedRows: warehouseIdsToInsert.length,
    deletedRows: assignmentIdsToDelete.length,
  };
}

async function replaceInvitationProjectAssignmentsForInvitation(
  invitationId: number,
  projectIds?: number[] | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const normalizedProjectIds = normalizeProjectIds(projectIds);
  await db
    .delete(invitationProjectAssignments)
    .where(eq(invitationProjectAssignments.invitationId, invitationId));

  if (normalizedProjectIds.length > 0) {
    await db.insert(invitationProjectAssignments).values(
      normalizedProjectIds.map(projectId => ({
        invitationId,
        projectId,
      }))
    );
  }
}

async function hydrateUsersWithAssignedProjects<T extends User>(
  rows: T[]
): Promise<
  Array<T & { assignedProjectIds: number[]; assignedProjects: any[] }>
> {
  const db = await getDb();
  if (!db || rows.length === 0)
    return rows.map(row => ({
      ...row,
      assignedProjectIds: row.assignedProjectId ? [row.assignedProjectId] : [],
      assignedProjects: [],
    }));

  const userIds = rows.map(row => row.id);
  const assignmentRows = await db
    .select({
      userId: userProjectAssignments.userId,
      project: projects,
    })
    .from(userProjectAssignments)
    .innerJoin(projects, eq(userProjectAssignments.projectId, projects.id))
    .where(inArray(userProjectAssignments.userId, userIds))
    .orderBy(asc(projects.code), asc(projects.name));

  const assignmentsByUserId = new Map<number, any[]>();
  for (const row of assignmentRows) {
    const current = assignmentsByUserId.get(row.userId) ?? [];
    current.push(row.project);
    assignmentsByUserId.set(row.userId, current);
  }

  return rows.map(row => {
    const assignedProjects = assignmentsByUserId.get(row.id) ?? [];
    const assignedProjectIds =
      assignedProjects.length > 0
        ? assignedProjects.map(project => project.id)
        : row.assignedProjectId
          ? [row.assignedProjectId]
          : [];

    return {
      ...row,
      assignedProjectIds,
      assignedProjects,
    };
  });
}

async function hydrateInvitationsWithAssignedProjects<T extends Invitation>(
  rows: T[]
): Promise<
  Array<T & { assignedProjectIds: number[]; assignedProjects: any[] }>
> {
  const db = await getDb();
  if (!db || rows.length === 0)
    return rows.map(row => ({
      ...row,
      assignedProjectIds: row.assignedProjectId ? [row.assignedProjectId] : [],
      assignedProjects: [],
    }));

  const invitationIds = rows.map(row => row.id);
  const assignmentRows = await db
    .select({
      invitationId: invitationProjectAssignments.invitationId,
      project: projects,
    })
    .from(invitationProjectAssignments)
    .innerJoin(
      projects,
      eq(invitationProjectAssignments.projectId, projects.id)
    )
    .where(inArray(invitationProjectAssignments.invitationId, invitationIds))
    .orderBy(asc(projects.code), asc(projects.name));

  const assignmentsByInvitationId = new Map<number, any[]>();
  for (const row of assignmentRows) {
    const current = assignmentsByInvitationId.get(row.invitationId) ?? [];
    current.push(row.project);
    assignmentsByInvitationId.set(row.invitationId, current);
  }

  return rows.map(row => {
    const assignedProjects = assignmentsByInvitationId.get(row.id) ?? [];
    const assignedProjectIds =
      assignedProjects.length > 0
        ? assignedProjects.map(project => project.id)
        : row.assignedProjectId
          ? [row.assignedProjectId]
          : [];

    return {
      ...row,
      assignedProjectIds,
      assignedProjects,
    };
  });
}

export async function upsertUser(
  user: InsertUser & { assignedProjectIds?: number[] | null }
): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (user.buildreqRole !== undefined) {
    values.buildreqRole = user.buildreqRole;
    updateSet.buildreqRole = user.buildreqRole;
  }
  if (user.assignedProjectId !== undefined) {
    values.assignedProjectId = user.assignedProjectId ?? null;
    updateSet.assignedProjectId = user.assignedProjectId ?? null;
  } else if (user.assignedProjectIds !== undefined) {
    values.assignedProjectId =
      normalizeProjectIds(user.assignedProjectIds)[0] ?? null;
    updateSet.assignedProjectId =
      normalizeProjectIds(user.assignedProjectIds)[0] ?? null;
  }
  if (user.mustChangePassword !== undefined) {
    values.mustChangePassword = user.mustChangePassword;
    updateSet.mustChangePassword = user.mustChangePassword;
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  const db = await getDb();
  if (!db) return;
  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.openId,
      set: updateSet as any,
    });

  if (user.assignedProjectIds !== undefined) {
    const [savedUser] = await db
      .select({ id: users.id, buildreqRole: users.buildreqRole })
      .from(users)
      .where(eq(users.openId, user.openId))
      .limit(1);
    if (savedUser) {
      await replaceUserProjectAssignmentsForUser(
        savedUser.id,
        user.assignedProjectIds
      );
      await syncUserWarehouseAssignmentsFromProjects({
        userId: savedUser.id,
        buildreqRole: user.buildreqRole ?? savedUser.buildreqRole,
        projectIds: user.assignedProjectIds,
      });
    }
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  if (result.length === 0) return undefined;
  const [user] = await hydrateUsersWithAssignedProjects(result);
  return user;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (result.length === 0) return undefined;
  const [user] = await hydrateUsersWithAssignedProjects(result);
  return user;
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  return hydrateUsersWithAssignedProjects(rows);
}

export async function bootstrapInitialAdmin(userId: number) {
  const db = await getDb();
  if (!db) return false;

  const [adminCountResult, totalUsersResult] = await Promise.all([
    db.select({ count: count() }).from(users).where(eq(users.role, "admin")),
    db.select({ count: count() }).from(users),
  ]);

  const adminCount = adminCountResult[0]?.count ?? 0;
  const totalUsers = totalUsersResult[0]?.count ?? 0;

  if (adminCount > 0 || totalUsers !== 1) {
    return false;
  }

  await db
    .update(users)
    .set({
      role: "admin",
      buildreqRole: "administracion_central",
      assignedProjectId: null,
    })
    .where(eq(users.id, userId));

  return true;
}

export async function updateUserRole(
  userId: number,
  buildreqRole: BuildReqRole,
  assignedProjectId?: number | null,
  assignedProjectIds?: number[] | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [targetUser] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const where = targetUser?.email?.trim()
    ? sql`lower(${users.email}) = lower(${targetUser.email})`
    : eq(users.id, userId);

  const normalizedProjectIds =
    assignedProjectIds !== undefined
      ? normalizeProjectIds(assignedProjectIds)
      : assignedProjectId
        ? [assignedProjectId]
        : [];
  const legacyAssignedProjectId = normalizedProjectIds[0] ?? null;
  const targetUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(where);

  await db
    .update(users)
    .set({ buildreqRole, assignedProjectId: legacyAssignedProjectId })
    .where(where);

  for (const row of targetUsers) {
    await replaceUserProjectAssignmentsForUser(row.id, normalizedProjectIds);
    await syncUserWarehouseAssignmentsFromProjects({
      userId: row.id,
      buildreqRole,
      projectIds: normalizedProjectIds,
    });
  }
  return { success: true };
}

export async function updateUserAdmin(
  userId: number,
  data: {
    name: string;
    email: string;
    buildreqRole: BuildReqRole;
    assignedProjectIds?: number[] | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const normalizedProjectIds = normalizeProjectIds(data.assignedProjectIds);
  const legacyAssignedProjectId = normalizedProjectIds[0] ?? null;

  await db
    .update(users)
    .set({
      name: data.name,
      email: data.email,
      buildreqRole: data.buildreqRole,
      assignedProjectId: legacyAssignedProjectId,
    })
    .where(eq(users.id, userId));

  await replaceUserProjectAssignmentsForUser(userId, normalizedProjectIds);
  await syncUserWarehouseAssignmentsFromProjects({
    userId,
    buildreqRole: data.buildreqRole,
    projectIds: normalizedProjectIds,
  });

  return { success: true };
}

export async function updateUserName(userId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.update(users).set({ name }).where(eq(users.id, userId));

  return { success: true };
}

export async function updateUserPasswordChangeRequirement(
  userId: number,
  mustChangePassword: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(users)
    .set({ mustChangePassword })
    .where(eq(users.id, userId));

  return { success: true };
}

// ============================================================
// PROJECTS
// ============================================================
function mapWarehouseSummary(
  row: Warehouse,
  options?: { isPrimary?: boolean }
) {
  return {
    id: row.id,
    code: row.code,
    localCode: row.localCode,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    isDefault: row.isDefault,
    isCentralWarehouse: row.isCentralWarehouse,
    isSharedWarehouse: row.isSharedWarehouse,
    isActive: row.isActive,
    isPrimary: Boolean(options?.isPrimary),
  };
}

function orderProjectWarehouses(
  project: typeof projects.$inferSelect,
  assignedWarehouses: Warehouse[]
) {
  const seen = new Set<number>();
  const uniqueWarehouses = assignedWarehouses.filter(warehouse => {
    if (seen.has(warehouse.id)) return false;
    seen.add(warehouse.id);
    return true;
  });

  return uniqueWarehouses.sort((left, right) => {
    if (left.id === project.warehouseId) return -1;
    if (right.id === project.warehouseId) return 1;
    return (
      left.code.localeCompare(right.code) || left.name.localeCompare(right.name)
    );
  });
}

async function getProjectWarehousesByProjectId(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectRows: Array<typeof projects.$inferSelect>
) {
  const warehousesByProjectId = new Map<number, Warehouse[]>();
  if (projectRows.length === 0) return warehousesByProjectId;

  const projectIds = projectRows.map(project => project.id);
  const assignmentRows = await db
    .select({
      projectId: projectWarehouseAssignments.projectId,
      warehouse: warehouses,
    })
    .from(projectWarehouseAssignments)
    .innerJoin(
      warehouses,
      eq(projectWarehouseAssignments.warehouseId, warehouses.id)
    )
    .where(inArray(projectWarehouseAssignments.projectId, projectIds))
    .orderBy(
      asc(projectWarehouseAssignments.projectId),
      desc(projectWarehouseAssignments.isPrimary),
      asc(warehouses.code),
      asc(warehouses.name)
    );

  for (const row of assignmentRows) {
    const current = warehousesByProjectId.get(row.projectId) ?? [];
    current.push(row.warehouse);
    warehousesByProjectId.set(row.projectId, current);
  }

  const legacyWarehouseIds = Array.from(
    new Set(
      projectRows
        .map(project => project.warehouseId)
        .filter((id): id is number => typeof id === "number")
    )
  );
  if (legacyWarehouseIds.length > 0) {
    const legacyWarehouseRows = await db
      .select()
      .from(warehouses)
      .where(inArray(warehouses.id, legacyWarehouseIds));
    const legacyWarehouseById = new Map(
      legacyWarehouseRows.map(warehouse => [warehouse.id, warehouse])
    );

    for (const project of projectRows) {
      if (!project.warehouseId) continue;
      const legacyWarehouse = legacyWarehouseById.get(project.warehouseId);
      if (!legacyWarehouse) continue;
      const current = warehousesByProjectId.get(project.id) ?? [];
      if (!current.some(warehouse => warehouse.id === legacyWarehouse.id)) {
        current.push(legacyWarehouse);
        warehousesByProjectId.set(project.id, current);
      }
    }
  }

  for (const project of projectRows) {
    warehousesByProjectId.set(
      project.id,
      orderProjectWarehouses(
        project,
        warehousesByProjectId.get(project.id) ?? []
      )
    );
  }

  return warehousesByProjectId;
}

function mapProjectWithWarehouses(
  project: typeof projects.$inferSelect,
  assignedWarehouses: Warehouse[] = [],
  subprojectsCount = 0,
  inventorySummary?: {
    inventoryRows?: number;
    totalStock?: string | number | null;
  }
) {
  const orderedWarehouses = orderProjectWarehouses(project, assignedWarehouses);
  const warehouseSummaries = orderedWarehouses.map(warehouse =>
    mapWarehouseSummary(warehouse, {
      isPrimary: warehouse.id === project.warehouseId,
    })
  );
  const warehouseSummary =
    warehouseSummaries.find(
      warehouse => warehouse.id === project.warehouseId
    ) ??
    warehouseSummaries[0] ??
    null;

  return {
    ...project,
    warehouses: warehouseSummaries,
    defaultWarehouse: warehouseSummary,
    warehouse: warehouseSummary,
    warehouseCount: warehouseSummaries.length,
    inventoryRows: Number(inventorySummary?.inventoryRows ?? 0),
    totalStock: toDecimalString(inventorySummary?.totalStock ?? 0),
    subprojectsCount,
  };
}

export async function listProjects(statusFilter?: string) {
  const db = await getDb();
  if (!db) return [];
  const where = statusFilter
    ? eq(projects.status, statusFilter as any)
    : undefined;

  const projectRows = await db
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.createdAt));

  const projectIds = projectRows.map(project => project.id);
  const [warehousesByProjectId, subprojectCounts, inventoryRows] =
    await Promise.all([
      getProjectWarehousesByProjectId(db, projectRows),
      db
        .select({
          projectId: projectSubprojects.projectId,
          total: count(),
        })
        .from(projectSubprojects)
        .groupBy(projectSubprojects.projectId),
      db
        .select({
          projectId: inventoryItems.projectId,
          inventoryRows: count(),
          totalStock: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
        })
        .from(inventoryItems)
        .where(
          projectIds.length > 0
            ? inArray(inventoryItems.projectId, projectIds)
            : sql`1 = 0`
        )
        .groupBy(inventoryItems.projectId),
    ]);

  const countByProject = new Map(
    subprojectCounts.map(entry => [entry.projectId, entry.total])
  );
  const inventoryByProject = new Map(
    inventoryRows
      .filter(entry => typeof entry.projectId === "number")
      .map(entry => [
        entry.projectId as number,
        {
          inventoryRows: Number(entry.inventoryRows ?? 0),
          totalStock: entry.totalStock,
        },
      ])
  );

  return projectRows.map(project =>
    mapProjectWithWarehouses(
      project,
      warehousesByProjectId.get(project.id) ?? [],
      countByProject.get(project.id) ?? 0,
      inventoryByProject.get(project.id)
    )
  );
}

export async function getProjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) return undefined;

  const [warehousesByProjectId, subprojects, inventorySummary] =
    await Promise.all([
      getProjectWarehousesByProjectId(db, [project]),
      db
        .select({ total: count() })
        .from(projectSubprojects)
        .where(eq(projectSubprojects.projectId, id)),
      db
        .select({
          inventoryRows: count(),
          totalStock: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
        })
        .from(inventoryItems)
        .where(eq(inventoryItems.projectId, id)),
    ]);

  return mapProjectWithWarehouses(
    project,
    warehousesByProjectId.get(project.id) ?? [],
    subprojects?.[0]?.total ?? 0,
    {
      inventoryRows: Number(inventorySummary?.[0]?.inventoryRows ?? 0),
      totalStock: inventorySummary?.[0]?.totalStock ?? "0.00",
    }
  );
}

export async function getProjectByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.code, code))
    .limit(1);
  return result[0] ? getProjectById(result[0].id) : undefined;
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [project] = await db.insert(projects).values(data).returning();
  return {
    id: project.id,
    warehouseId: project.warehouseId ?? null,
  };
}

export async function updateProject(id: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id));
  return { success: true };
}

export async function listProjectSubprojects(projectId: number) {
  const db = await getDb();
  if (!db) return [] as ProjectSubproject[];

  return db
    .select()
    .from(projectSubprojects)
    .where(eq(projectSubprojects.projectId, projectId))
    .orderBy(asc(projectSubprojects.code), asc(projectSubprojects.name));
}

export async function getProjectSubprojectByCode(
  projectId: number,
  code: string
) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(projectSubprojects)
    .where(
      and(
        eq(projectSubprojects.projectId, projectId),
        eq(projectSubprojects.code, code)
      )
    )
    .limit(1);

  return rows[0];
}

export async function getProjectSubprojectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(projectSubprojects)
    .where(eq(projectSubprojects.id, id))
    .limit(1);

  return rows[0];
}

export async function createProjectSubproject(data: InsertProjectSubproject) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [subproject] = await db
    .insert(projectSubprojects)
    .values(data)
    .returning();

  return subproject;
}

export async function updateProjectSubproject(
  id: number,
  data: Partial<InsertProjectSubproject>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [subproject] = await db
    .update(projectSubprojects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projectSubprojects.id, id))
    .returning();

  return subproject;
}

export async function listMaterialRequestTargetOptions(
  projectId: number,
  search?: string
) {
  const db = await getDb();
  if (!db) {
    return { subprojects: [], fixedAssets: [] };
  }

  const normalizedSearch = search?.trim();
  const subprojectConditions = [
    eq(projectSubprojects.projectId, projectId),
    eq(projectSubprojects.isActive, true),
  ];
  const fixedAssetConditions = [
    eq(sapCatalog.isActive, true),
    eq(sapCatalog.tipoArticulo, 3),
    eq(sapCatalog.projectId, projectId),
  ];

  if (normalizedSearch) {
    subprojectConditions.push(
      or(
        ilike(projectSubprojects.code, `%${normalizedSearch}%`),
        ilike(projectSubprojects.name, `%${normalizedSearch}%`),
        ilike(projectSubprojects.description, `%${normalizedSearch}%`)
      )!
    );
    fixedAssetConditions.push(
      or(
        ilike(sapCatalog.itemCode, `%${normalizedSearch}%`),
        ilike(sapCatalog.description, `%${normalizedSearch}%`)
      )!
    );
  }

  const [subprojects, fixedAssets] = await Promise.all([
    db
      .select()
      .from(projectSubprojects)
      .where(and(...subprojectConditions))
      .orderBy(asc(projectSubprojects.code), asc(projectSubprojects.name))
      .limit(50),
    db
      .select()
      .from(sapCatalog)
      .where(and(...fixedAssetConditions))
      .orderBy(asc(sapCatalog.itemCode))
      .limit(50),
  ]);

  return { subprojects, fixedAssets };
}

export async function getActiveFixedAssetByCode(
  itemCode: string,
  projectId?: number
) {
  const db = await getDb();
  if (!db) return undefined;

  const normalizedItemCode = itemCode.trim();
  if (!normalizedItemCode) return undefined;

  const conditions = [
    eq(sapCatalog.isActive, true),
    eq(sapCatalog.tipoArticulo, 3),
    eq(sapCatalog.itemCode, normalizedItemCode),
  ];

  if (projectId) {
    conditions.push(eq(sapCatalog.projectId, projectId));
  }

  const rows = await db
    .select()
    .from(sapCatalog)
    .where(and(...conditions))
    .limit(1);

  return rows[0];
}

// ============================================================
// MATERIAL REQUESTS
// ============================================================
const DOCUMENT_SEQUENCE_WIDTH = 8;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildProjectScopedDocumentNumber(params: {
  prefix: string;
  projectCode: string;
  existingNumbers: Array<string | null | undefined>;
  sequencePrefixes?: string[];
}) {
  const projectCode = params.projectCode.trim();
  if (!projectCode) {
    throw new Error("El proyecto no tiene código para correlativo");
  }

  const documentPrefix = `${params.prefix}-${projectCode}-`;
  const sequencePrefixes =
    params.sequencePrefixes && params.sequencePrefixes.length > 0
      ? Array.from(new Set(params.sequencePrefixes))
      : [params.prefix];
  const sequencePrefixPattern = `(?:${sequencePrefixes
    .map(prefix => escapeRegExp(`${prefix}-${projectCode}-`))
    .join("|")})`;
  const sequencePattern = new RegExp(
    `^${sequencePrefixPattern}(\\d{${DOCUMENT_SEQUENCE_WIDTH}})$`
  );
  const maxSequence = params.existingNumbers.reduce((max, value) => {
    const match = String(value ?? "").match(sequencePattern);
    if (!match) return max;

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);

  return `${documentPrefix}${String(maxSequence + 1).padStart(
    DOCUMENT_SEQUENCE_WIDTH,
    "0"
  )}`;
}

async function generateProjectScopedDocumentNumber(params: {
  prefix: string;
  projectId: number;
  selectExistingNumbers: (
    documentPrefix: string
  ) => Promise<Array<string | null | undefined>>;
}) {
  const project = await getProjectById(params.projectId);
  if (!project) {
    throw new Error("Proyecto no encontrado para correlativo");
  }

  const projectCode = project.code.trim();
  if (!projectCode) {
    throw new Error("El proyecto no tiene código para correlativo");
  }

  const documentPrefix = `${params.prefix}-${projectCode}-`;
  const existingNumbers = await params.selectExistingNumbers(documentPrefix);
  return buildProjectScopedDocumentNumber({
    prefix: params.prefix,
    projectCode,
    existingNumbers,
  });
}

export async function generateRequestNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "REQ",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: materialRequests.requestNumber })
        .from(materialRequests)
        .where(ilike(materialRequests.requestNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function createMaterialRequest(
  data: Omit<InsertMaterialRequest, "requestNumber">,
  items: Omit<InsertRequestItem, "requestId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const isService = data.requestType === "servicios";
  const recipient =
    data.recipient ??
    (isService ? "administrador_proyecto" : "bodega_proyecto");
  const workflowStage =
    data.workflowStage ??
    (isService ? "administrador_proyecto" : "bodega_proyecto");
  const approvalStatus =
    data.approvalStatus ?? (isService ? "pendiente" : "no_requiere");
  const requestNumber = await generateRequestNumber(data.projectId);
  const [request] = await db
    .insert(materialRequests)
    .values({
      ...data,
      recipient,
      workflowStage,
      approvalStatus,
      requestNumber,
    })
    .returning({ id: materialRequests.id });
  const requestId = request.id;

  if (items.length > 0) {
    await db
      .insert(requestItems)
      .values(items.map(item => ({ ...item, requestId })));
  }

  return { id: requestId, requestNumber };
}

function mapMaterialRequestTarget(
  request: {
    targetType?: "subproyecto" | "activo_fijo" | null;
    subProjectId?: number | null;
    fixedAssetSapItemCode?: string | null;
    fixedAssetName?: string | null;
  },
  subproject?: ProjectSubproject | null
) {
  if (request.targetType === "subproyecto" && request.subProjectId) {
    const subprojectLabel = subproject
      ? `${subproject.code} - ${subproject.name}`
      : `Subproyecto #${request.subProjectId}`;
    return {
      type: "subproyecto" as const,
      subProjectId: request.subProjectId,
      projectId: subproject?.projectId ?? null,
      code: subproject?.code ?? null,
      name: subproject?.name ?? null,
      label: `Subproyecto: ${subprojectLabel}`,
    };
  }

  if (request.targetType === "activo_fijo" && request.fixedAssetSapItemCode) {
    const assetLabel = request.fixedAssetName
      ? `${request.fixedAssetSapItemCode} - ${request.fixedAssetName}`
      : request.fixedAssetSapItemCode;
    return {
      type: "activo_fijo" as const,
      fixedAssetSapItemCode: request.fixedAssetSapItemCode,
      fixedAssetName: request.fixedAssetName ?? null,
      label: `Activo fijo: ${assetLabel}`,
    };
  }

  return null;
}

export async function updateMaterialRequest(
  id: number,
  data: Partial<InsertMaterialRequest>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(materialRequests)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(materialRequests.id, id));

  return { success: true };
}

export async function replaceRequestItems(
  requestId: number,
  items: Omit<InsertRequestItem, "requestId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.delete(requestItems).where(eq(requestItems.requestId, requestId));

  if (items.length > 0) {
    await db.insert(requestItems).values(
      items.map(item => ({
        ...item,
        requestId,
      }))
    );
  }

  return { success: true };
}

export async function listMaterialRequests(filters?: {
  projectId?: number;
  projectIds?: number[];
  status?: string;
  requestedById?: number;
  requestType?: string;
  workflowStage?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.projectId)
    conditions.push(eq(materialRequests.projectId, filters.projectId));
  if (filters?.projectIds) {
    applyProjectScope(
      conditions,
      materialRequests.projectId,
      filters.projectIds
    );
  }
  if (filters?.status) {
    conditions.push(sql`${materialRequests.status}::text = ${filters.status}`);
  }
  if (filters?.requestedById)
    conditions.push(eq(materialRequests.requestedById, filters.requestedById));
  if (filters?.requestType)
    conditions.push(
      eq(materialRequests.requestType, filters.requestType as any)
    );
  if (filters?.workflowStage)
    conditions.push(
      eq(materialRequests.workflowStage, filters.workflowStage as any)
    );

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      request: materialRequests,
      project: projects,
      requestedBy: users,
    })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .leftJoin(users, eq(materialRequests.requestedById, users.id))
    .where(where)
    .orderBy(desc(materialRequests.createdAt));

  if (rows.length === 0) {
    return rows;
  }

  const requestIds = rows.map(row => row.request.id);
  const targetRows = await db
    .select({
      requestId: requestItems.requestId,
      itemId: requestItems.id,
      itemName: requestItems.itemName,
      targetType: requestItems.targetType,
      subProjectId: requestItems.subProjectId,
      fixedAssetSapItemCode: requestItems.fixedAssetSapItemCode,
      fixedAssetName: requestItems.fixedAssetName,
      targetSubproject: projectSubprojects,
    })
    .from(requestItems)
    .leftJoin(
      projectSubprojects,
      eq(requestItems.subProjectId, projectSubprojects.id)
    )
    .where(
      and(
        inArray(requestItems.requestId, requestIds),
        isNotNull(requestItems.targetType)
      )
    )
    .orderBy(asc(requestItems.id));
  const itemTargetsByRequestId = new Map<number, unknown[]>();

  for (const row of targetRows) {
    const target = mapMaterialRequestTarget(row, row.targetSubproject);
    if (!target) continue;

    const current = itemTargetsByRequestId.get(row.requestId) ?? [];
    current.push({
      ...target,
      itemId: row.itemId,
      itemName: row.itemName,
    });
    itemTargetsByRequestId.set(row.requestId, current);
  }

  return rows.map(row => ({
    ...row,
    itemTargets: itemTargetsByRequestId.get(row.request.id) ?? [],
  }));
}

async function getCommittedQuantityForItem(
  requestId: number,
  item: { sapItemCode?: string | null; itemName: string }
) {
  const db = await getDb();
  if (!db) return "0.00";
  if (!item.sapItemCode) return "0.00";

  const rows = await db
    .select({
      quantity: requestItems.quantity,
      deliveredQuantity: requestItems.deliveredQuantity,
      requestStatus: materialRequests.status,
    })
    .from(requestItems)
    .leftJoin(materialRequests, eq(requestItems.requestId, materialRequests.id))
    .where(
      and(
        eq(requestItems.sapItemCode, item.sapItemCode),
        sql`${requestItems.requestId} <> ${requestId}`,
        or(
          and(
            sql`${requestItems.status} <> 'completo'`,
            sql`${materialRequests.status}::text IN ('pendiente_aprobar', 'en_espera', 'en_proceso', 'parcialmente_atendida')`
          ),
          inArray(materialRequests.status, [
            "flujo_completado",
            "cerrada_incompleta",
          ])
        )
      )
    );

  const total = rows.reduce((sum, row) => {
    if (
      row.requestStatus === "flujo_completado" ||
      row.requestStatus === "cerrada_incompleta"
    ) {
      return sum + Math.max(parseDecimal(row.deliveredQuantity), 0);
    }

    const pending = Math.max(
      parseDecimal(row.quantity) - parseDecimal(row.deliveredQuantity),
      0
    );
    return sum + pending;
  }, 0);

  return toDecimalString(total);
}

async function getStockByItem(params: {
  sapItemCode?: string | null;
  itemName: string;
  projectId?: number | null;
  warehouseId?: number | null;
}) {
  const db = await getDb();
  if (!db) return "0.00";

  const conditions = [];
  if (params.sapItemCode) {
    conditions.push(eq(inventoryItems.sapItemCode, params.sapItemCode));
  } else {
    conditions.push(
      sql`lower(${inventoryItems.name}) = lower(${params.itemName})`
    );
  }
  if (params.projectId === null || params.projectId === undefined) {
    conditions.push(sql`${inventoryItems.projectId} IS NULL`);
  } else {
    conditions.push(eq(inventoryItems.projectId, params.projectId));
  }
  if (params.warehouseId) {
    conditions.push(eq(inventoryItems.warehouseId, params.warehouseId));
  }

  const rows = await db
    .select({ currentStock: inventoryItems.currentStock })
    .from(inventoryItems)
    .where(and(...conditions));

  const total = rows.reduce(
    (sum, row) => sum + parseDecimal(row.currentStock),
    0
  );
  return toDecimalString(total);
}

async function getProjectSharedWarehouseIds(projectId: number) {
  const projectWarehouses = await listProjectWarehouses(projectId, {
    isActive: true,
  });
  return projectWarehouses
    .filter(warehouse => warehouse.isSharedWarehouse)
    .map(warehouse => warehouse.id);
}

async function getProjectStockBreakdownByWarehouse(params: {
  sapItemCode?: string | null;
  itemName: string;
  projectId: number;
}) {
  const projectWarehouses = await listProjectWarehouses(params.projectId, {
    isActive: true,
  });
  const stockRows = await listInventoryRowsForStock({
    sapItemCode: params.sapItemCode,
    itemName: params.itemName,
    projectId: params.projectId,
  });
  const projectWarehouseById = new Map(
    projectWarehouses.map(warehouse => [warehouse.id, warehouse])
  );
  const quantitiesByWarehouse = new Map<number, number>(
    projectWarehouses.map(warehouse => [warehouse.id, 0])
  );
  const extraWarehouseIds = new Set<number>();
  let legacyQuantity = 0;

  for (const row of stockRows) {
    const quantity = parseDecimal(row.currentStock);
    if (typeof row.warehouseId === "number") {
      if (quantitiesByWarehouse.has(row.warehouseId)) {
        quantitiesByWarehouse.set(
          row.warehouseId,
          (quantitiesByWarehouse.get(row.warehouseId) ?? 0) + quantity
        );
      } else {
        extraWarehouseIds.add(row.warehouseId);
        quantitiesByWarehouse.set(
          row.warehouseId,
          (quantitiesByWarehouse.get(row.warehouseId) ?? 0) + quantity
        );
      }
    } else {
      legacyQuantity += quantity;
    }
  }

  const db = await getDb();
  const extraWarehouseRows =
    db && extraWarehouseIds.size > 0
      ? await db
          .select()
          .from(warehouses)
          .where(inArray(warehouses.id, Array.from(extraWarehouseIds)))
      : [];
  const extraWarehouseById = new Map(
    extraWarehouseRows.map(row => [row.id, row])
  );
  const total = Array.from(quantitiesByWarehouse.values()).reduce(
    (sum, quantity) => sum + quantity,
    legacyQuantity
  );

  const mapWarehouseStock = (warehouse: Warehouse) => ({
    warehouseId: warehouse.id,
    warehouseCode: warehouse.code,
    localCode: warehouse.localCode,
    warehouseName: warehouse.name,
    displayName: warehouse.displayName,
    isDefault: warehouse.isDefault,
    isActive: warehouse.isActive,
    quantity: toDecimalString(quantitiesByWarehouse.get(warehouse.id) ?? 0),
  });

  const projectBreakdown = projectWarehouses.map(mapWarehouseStock);
  const extraBreakdown = Array.from(extraWarehouseIds).map(warehouseId => {
    const warehouse = extraWarehouseById.get(warehouseId);
    return warehouse
      ? mapWarehouseStock(warehouse)
      : {
          warehouseId,
          warehouseCode: null,
          localCode: null,
          warehouseName: null,
          displayName: `Almacén #${warehouseId}`,
          isDefault: false,
          isActive: false,
          quantity: toDecimalString(
            quantitiesByWarehouse.get(warehouseId) ?? 0
          ),
        };
  });
  const legacyBreakdown =
    legacyQuantity > 0
      ? [
          {
            warehouseId: null,
            warehouseCode: null,
            localCode: null,
            warehouseName: null,
            displayName: "Sin almacén asignado",
            isDefault: false,
            isActive: false,
            quantity: toDecimalString(legacyQuantity),
          },
        ]
      : [];

  return {
    quantity: toDecimalString(total),
    warehouses: [...projectBreakdown, ...extraBreakdown, ...legacyBreakdown],
  };
}

async function getAssignedWarehouseStockBreakdown(params: {
  sapItemCode?: string | null;
  itemName: string;
  projectId: number;
}) {
  const db = await getDb();
  const projectWarehouses = await listProjectWarehouses(params.projectId, {
    isActive: true,
  });
  if (!db || projectWarehouses.length === 0) {
    return {
      quantity: "0.00",
      warehouses: [],
    };
  }

  const warehouseIds = projectWarehouses.map(warehouse => warehouse.id);
  const conditions = [
    eq(inventoryItems.isActive, true),
    sql`${inventoryItems.projectId} IS NOT NULL`,
    inArray(inventoryItems.warehouseId, warehouseIds),
  ];
  const sapItemCode = params.sapItemCode?.trim() || null;
  if (sapItemCode) {
    conditions.push(eq(inventoryItems.sapItemCode, sapItemCode));
  } else {
    conditions.push(
      sql`lower(${inventoryItems.name}) = lower(${params.itemName})`
    );
  }

  const rows = await db
    .select({
      warehouseId: inventoryItems.warehouseId,
      quantity: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
    })
    .from(inventoryItems)
    .where(and(...conditions))
    .groupBy(inventoryItems.warehouseId);

  const quantitiesByWarehouse = new Map<number, number>();
  for (const row of rows) {
    if (typeof row.warehouseId !== "number") continue;
    quantitiesByWarehouse.set(row.warehouseId, parseDecimal(row.quantity));
  }

  const warehouses = projectWarehouses.map(warehouse => ({
    warehouseId: warehouse.id,
    warehouseCode: warehouse.code,
    localCode: warehouse.localCode,
    warehouseName: warehouse.name,
    displayName: warehouse.displayName,
    isDefault: warehouse.isDefault,
    isActive: warehouse.isActive,
    quantity: toDecimalString(quantitiesByWarehouse.get(warehouse.id) ?? 0),
  }));
  const total = warehouses.reduce(
    (sum, warehouse) => sum + parseDecimal(warehouse.quantity),
    0
  );

  return {
    quantity: toDecimalString(total),
    warehouses,
  };
}

export async function listProjectStockForItems(params: {
  projectId: number;
  items: Array<{
    id: number;
    sapItemCode?: string | null;
    itemName: string;
  }>;
}) {
  const db = await getDb();
  const stockByKey = new Map<string, string>();
  const breakdownByKey = new Map<
    string,
    Array<{
      warehouseId: number | null;
      warehouseCode: string | null;
      warehouseName: string | null;
      displayName: string | null;
      quantity: string;
    }>
  >();

  for (const item of params.items) {
    const sapItemCode = item.sapItemCode?.trim() || null;
    const itemName = item.itemName.trim();
    const key = sapItemCode
      ? `sap:${sapItemCode}`
      : `name:${itemName.toLowerCase()}`;
    if (stockByKey.has(key)) continue;

    const stockRows = await listInventoryRowsForStock({
      sapItemCode,
      itemName,
      projectId: params.projectId,
    });
    const warehouseIds = Array.from(
      new Set(
        stockRows
          .map(row => row.warehouseId)
          .filter((value): value is number => typeof value === "number")
      )
    );
    const warehouseRows =
      db && warehouseIds.length > 0
        ? await db
            .select()
            .from(warehouses)
            .where(inArray(warehouses.id, warehouseIds))
        : [];
    const warehouseById = new Map(warehouseRows.map(row => [row.id, row]));
    const quantityByWarehouse = new Map<number | null, number>();
    for (const row of stockRows) {
      const warehouseKey = row.warehouseId ?? null;
      quantityByWarehouse.set(
        warehouseKey,
        (quantityByWarehouse.get(warehouseKey) ?? 0) +
          parseDecimal(row.currentStock)
      );
    }

    const total = Array.from(quantityByWarehouse.values()).reduce(
      (sum, value) => sum + value,
      0
    );
    stockByKey.set(key, toDecimalString(total));
    breakdownByKey.set(
      key,
      Array.from(quantityByWarehouse.entries()).map(
        ([warehouseId, quantity]) => {
          const warehouse =
            typeof warehouseId === "number"
              ? warehouseById.get(warehouseId)
              : null;
          return {
            warehouseId,
            warehouseCode: warehouse?.code ?? null,
            warehouseName: warehouse?.name ?? null,
            displayName:
              warehouse?.displayName ??
              stockRows.find(row => row.warehouseId === warehouseId)
                ?.warehouseLocation ??
              null,
            quantity: toDecimalString(quantity),
          };
        }
      )
    );
  }

  return params.items.map(item => {
    const sapItemCode = item.sapItemCode?.trim() || null;
    const itemName = item.itemName.trim();
    const key = sapItemCode
      ? `sap:${sapItemCode}`
      : `name:${itemName.toLowerCase()}`;

    return {
      itemId: item.id,
      quantity: stockByKey.get(key) ?? "0.00",
      warehouses: breakdownByKey.get(key) ?? [],
    };
  });
}

export async function listVisibleWarehouseStockForItems(params: {
  warehouseIds: number[];
  hideQuantities?: boolean;
  items: Array<{
    id: number;
    sapItemCode?: string | null;
    itemName: string;
  }>;
}) {
  const db = await getDb();
  if (!db || params.warehouseIds.length === 0) {
    return params.items.map(item => ({
      itemId: item.id,
      quantity: "0.00",
      warehouses: [],
    }));
  }

  const warehouseIds = Array.from(new Set(params.warehouseIds));
  const [assignedProjectRows, legacyProjectRows] = await Promise.all([
    db
      .select({
        warehouseId: warehouses.id,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        warehouseDisplayName: warehouses.displayName,
        projectId: projects.id,
        projectCode: projects.code,
        projectName: projects.name,
        isPrimary: projectWarehouseAssignments.isPrimary,
      })
      .from(warehouses)
      .leftJoin(
        projectWarehouseAssignments,
        eq(projectWarehouseAssignments.warehouseId, warehouses.id)
      )
      .leftJoin(projects, eq(projectWarehouseAssignments.projectId, projects.id))
      .where(inArray(warehouses.id, warehouseIds))
      .orderBy(
        asc(warehouses.displayName),
        desc(projectWarehouseAssignments.isPrimary),
        asc(projects.code)
      ),
    db
      .select({
        warehouseId: warehouses.id,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        warehouseDisplayName: warehouses.displayName,
        projectId: projects.id,
        projectCode: projects.code,
        projectName: projects.name,
        isPrimary: sql<boolean>`true`,
      })
      .from(projects)
      .innerJoin(warehouses, eq(projects.warehouseId, warehouses.id))
      .where(inArray(projects.warehouseId, warehouseIds)),
  ]);
  const visibleWarehouseOptionsByScope = new Map<
    string,
    {
      warehouseId: number;
      warehouseCode: string | null;
      warehouseName: string | null;
      displayName: string | null;
      projectId: number | null;
      projectCode: string | null;
      projectName: string | null;
      quantity: string;
    }
  >();
  for (const row of [...assignedProjectRows, ...legacyProjectRows]) {
    if (
      typeof row.warehouseId !== "number" ||
      typeof row.projectId !== "number"
    ) {
      continue;
    }
    const scopeKey = `${row.projectId}:${row.warehouseId}`;
    if (visibleWarehouseOptionsByScope.has(scopeKey)) continue;
    visibleWarehouseOptionsByScope.set(scopeKey, {
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      displayName: row.warehouseDisplayName,
      projectId: row.projectId,
      projectCode: row.projectCode,
      projectName: row.projectName,
      quantity: "0.00",
    });
  }
  if (params.hideQuantities) {
    const options = Array.from(visibleWarehouseOptionsByScope.values()).sort(
      (left, right) => {
        const leftProject = left.projectCode ?? "";
        const rightProject = right.projectCode ?? "";
        return (
          leftProject.localeCompare(rightProject) ||
          (left.displayName ?? "").localeCompare(right.displayName ?? "") ||
          left.warehouseId - right.warehouseId
        );
      }
    );

    return params.items.map(item => ({
      itemId: item.id,
      quantity: null,
      quantityHidden: true,
      warehouses: options.map(option => ({
        ...option,
        quantity: null,
        quantityHidden: true,
      })),
    }));
  }

  const stockByKey = new Map<string, string>();
  const breakdownByKey = new Map<
    string,
    Array<{
      warehouseId: number;
      warehouseCode: string | null;
      warehouseName: string | null;
      displayName: string | null;
      projectId: number | null;
      projectCode: string | null;
      projectName: string | null;
      quantity: string;
    }>
  >();

  for (const item of params.items) {
    const sapItemCode = item.sapItemCode?.trim() || null;
    const itemName = item.itemName.trim();
    const key = sapItemCode
      ? `sap:${sapItemCode}`
      : `name:${itemName.toLowerCase()}`;
    if (stockByKey.has(key)) continue;

    const itemConditions = [
      eq(inventoryItems.isActive, true),
      inArray(inventoryItems.warehouseId, warehouseIds),
      sql`${inventoryItems.projectId} IS NOT NULL`,
      sql`${inventoryItems.currentStock}::numeric > 0`,
    ];

    if (sapItemCode) {
      itemConditions.push(eq(inventoryItems.sapItemCode, sapItemCode));
    } else {
      itemConditions.push(
        sql`lower(${inventoryItems.name}) = lower(${itemName})`
      );
    }

    const rows = await db
      .select({
        warehouseId: inventoryItems.warehouseId,
        warehouseLocation: inventoryItems.warehouseLocation,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        warehouseDisplayName: warehouses.displayName,
        projectId: inventoryItems.projectId,
        projectCode: projects.code,
        projectName: projects.name,
        quantity: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
      })
      .from(inventoryItems)
      .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
      .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
      .where(and(...itemConditions))
      .groupBy(
        inventoryItems.warehouseId,
        inventoryItems.warehouseLocation,
        warehouses.code,
        warehouses.name,
        warehouses.displayName,
        inventoryItems.projectId,
        projects.code,
        projects.name
      )
      .orderBy(asc(projects.code), asc(warehouses.displayName));

    const optionsByScope = new Map(
      Array.from(visibleWarehouseOptionsByScope.entries()).map(
        ([scopeKey, option]) => [scopeKey, { ...option, quantity: "0.00" }]
      )
    );

    for (const row of rows) {
      if (typeof row.warehouseId !== "number") {
        continue;
      }

      if (typeof row.projectId !== "number") {
        continue;
      }
      const scopeKey = `${row.projectId}:${row.warehouseId}`;
      const existing = optionsByScope.get(scopeKey);
      optionsByScope.set(scopeKey, {
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
        displayName:
          existing?.displayName ??
          row.warehouseDisplayName ??
          row.warehouseLocation ??
          null,
        projectId: row.projectId,
        projectCode: row.projectCode,
        projectName: row.projectName,
        quantity: toDecimalString(row.quantity),
      });
    }

    const options = Array.from(optionsByScope.values()).sort((left, right) => {
      const leftProject = left.projectCode ?? "";
      const rightProject = right.projectCode ?? "";
      return (
        leftProject.localeCompare(rightProject) ||
        (left.displayName ?? "").localeCompare(right.displayName ?? "") ||
        left.warehouseId - right.warehouseId
      );
    });
    const total = options.reduce(
      (sum, row) => sum + parseDecimal(row.quantity),
      0
    );

    stockByKey.set(key, toDecimalString(total));
    breakdownByKey.set(key, options);
  }

  return params.items.map(item => {
    const sapItemCode = item.sapItemCode?.trim() || null;
    const itemName = item.itemName.trim();
    const key = sapItemCode
      ? `sap:${sapItemCode}`
      : `name:${itemName.toLowerCase()}`;

    return {
      itemId: item.id,
      quantity: stockByKey.get(key) ?? "0.00",
      warehouses: breakdownByKey.get(key) ?? [],
    };
  });
}

export async function getMaterialRequestById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      request: materialRequests,
      project: projects,
      requestedBy: users,
    })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .leftJoin(users, eq(materialRequests.requestedById, users.id))
    .where(eq(materialRequests.id, id))
    .limit(1);

  if (!rows[0]) return undefined;

  const items = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.requestId, id));
  const itemSubProjectIds = Array.from(
    new Set(
      items
        .map(item => item.subProjectId)
        .filter((subProjectId): subProjectId is number => Boolean(subProjectId))
    )
  );
  const itemSubprojects = itemSubProjectIds.length
    ? await db
        .select()
        .from(projectSubprojects)
        .where(inArray(projectSubprojects.id, itemSubProjectIds))
    : [];
  const itemSubprojectById = new Map(
    itemSubprojects.map(subproject => [subproject.id, subproject])
  );
  const itemIds = items.map(item => item.id);
  const transferWarehouseRows =
    itemIds.length > 0
      ? await db
          .select({
            materialRequestItemId: transferRequestItems.materialRequestItemId,
            sourceProjectId: transferRequests.projectId,
            sourceWarehouseId: transferRequestItems.sourceWarehouseId,
            receiptProjectId: receipts.projectId,
            receiptWarehouseId: receiptItems.warehouseId,
            receivedQuantity: receiptItems.quantityReceived,
            receiptItemId: receiptItems.id,
          })
          .from(transferRequestItems)
          .innerJoin(
            transferRequests,
            eq(transferRequestItems.transferRequestId, transferRequests.id)
          )
          .leftJoin(
            transfers,
            eq(transfers.transferRequestId, transferRequests.id)
          )
          .leftJoin(
            receipts,
            and(
              eq(receipts.sourceType, "transfer"),
              eq(receipts.sourceId, transfers.id)
            )
          )
          .leftJoin(
            receiptItems,
            and(
              eq(receiptItems.receiptId, receipts.id),
              eq(receiptItems.sourceItemId, transferRequestItems.id)
            )
          )
          .where(
            and(
              inArray(transferRequestItems.materialRequestItemId, itemIds),
              inArray(transferRequests.status, [
                "pendiente",
                "aprobada",
                "convertida",
              ])
            )
          )
      : [];
  const transferWarehouseByItemId = new Map<
    number,
    {
      sourceProjectId: number | null;
      sourceWarehouseId: number | null;
      receiptProjectId: number | null;
      receiptWarehouseId: number | null;
      receiptItemId: number | null;
    }
  >();

  for (const row of transferWarehouseRows) {
    if (!row.materialRequestItemId) continue;
    const current = transferWarehouseByItemId.get(row.materialRequestItemId);
    const receivedQuantity = parseDecimal(row.receivedQuantity);
    const hasReceiptWarehouse =
      receivedQuantity > 0 && typeof row.receiptWarehouseId === "number";
    const nextValue = {
      sourceProjectId: row.sourceProjectId ?? null,
      sourceWarehouseId: row.sourceWarehouseId ?? null,
      receiptProjectId: hasReceiptWarehouse ? (row.receiptProjectId ?? null) : null,
      receiptWarehouseId: hasReceiptWarehouse ? row.receiptWarehouseId : null,
      receiptItemId: hasReceiptWarehouse ? (row.receiptItemId ?? null) : null,
    };

    if (!current) {
      transferWarehouseByItemId.set(row.materialRequestItemId, nextValue);
      continue;
    }

    if (
      nextValue.receiptWarehouseId &&
      (!current.receiptWarehouseId ||
        (nextValue.receiptItemId ?? 0) > (current.receiptItemId ?? 0))
    ) {
      transferWarehouseByItemId.set(row.materialRequestItemId, nextValue);
      continue;
    }

    if (!current.sourceWarehouseId && nextValue.sourceWarehouseId) {
      transferWarehouseByItemId.set(row.materialRequestItemId, {
        ...current,
        sourceProjectId: nextValue.sourceProjectId,
        sourceWarehouseId: nextValue.sourceWarehouseId,
      });
    }
  }

  const enrichedItems = await Promise.all(
    items.map(async item => {
      const sapItemCode = item.sapItemCode?.trim() || null;
      const transferWarehouse = transferWarehouseByItemId.get(item.id);
      const committedQuantity = sapItemCode
        ? await getCommittedQuantityForItem(id, item)
        : null;
      const sapStock = sapItemCode
        ? await getStockByItem({
            sapItemCode,
            itemName: item.itemName,
          })
        : null;
      const projectStock = sapItemCode
        ? await getProjectStockBreakdownByWarehouse({
            sapItemCode,
            itemName: item.itemName,
            projectId: rows[0].request.projectId,
          })
        : null;
      const warehouseStock = sapItemCode
        ? await getAssignedWarehouseStockBreakdown({
            sapItemCode,
            itemName: item.itemName,
            projectId: rows[0].request.projectId,
          })
        : null;

      return {
        ...item,
        target: mapMaterialRequestTarget(
          item,
          item.subProjectId
            ? (itemSubprojectById.get(item.subProjectId) ?? null)
            : null
        ),
        committedQuantity: sapItemCode
          ? (item.committedQuantity ?? committedQuantity)
          : null,
        sapStock,
        projectStock: projectStock?.quantity ?? null,
        projectStockWarehouses: projectStock?.warehouses ?? [],
        warehouseStock: warehouseStock?.quantity ?? null,
        warehouseStockWarehouses: warehouseStock?.warehouses ?? [],
        transferSourceWarehouseId:
          transferWarehouse?.sourceWarehouseId ?? null,
        transferSourceProjectId: transferWarehouse?.sourceProjectId ?? null,
        transferReceiptProjectId: transferWarehouse?.receiptProjectId ?? null,
        transferReceiptWarehouseId:
          transferWarehouse?.receiptWarehouseId ?? null,
        physicalDispatchedQuantity: item.dispatchedQuantity ?? "0.00",
        dispatchedQuantity:
          item.dispatchedQuantity ?? item.deliveredQuantity ?? "0.00",
      };
    })
  );

  return {
    ...rows[0],
    items: enrichedItems,
  };
}

export async function updateMaterialRequestStatus(
  id: number,
  status:
    | "borrador"
    | "pendiente_aprobar"
    | "en_espera"
    | "en_proceso"
    | "parcialmente_atendida"
    | "flujo_completado"
    | "cerrada"
    | "cerrada_incompleta"
    | "anulada",
  processedById?: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const updateData: Record<string, unknown> = { status };
  if (processedById) updateData.processedById = processedById;
  if (
    status === "en_proceso" ||
    status === "parcialmente_atendida" ||
    status === "flujo_completado" ||
    status === "cerrada_incompleta"
  ) {
    updateData.processedAt = new Date();
  }
  if (status === "cerrada" || status === "cerrada_incompleta") {
    updateData.closedAt = new Date();
    updateData.workflowStage = "cerrada";
  } else if (status === "flujo_completado") {
    updateData.workflowStage = "bodega_proyecto";
    updateData.closedAt = null;
  } else if (status !== "anulada") {
    updateData.closedAt = null;
  }
  if (status === "anulada") updateData.workflowStage = "rechazada";

  await db
    .update(materialRequests)
    .set(updateData)
    .where(eq(materialRequests.id, id));
  return { success: true };
}

export async function syncMaterialRequestFulfillmentStatus(
  requestId: number,
  processedById?: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [request] = await db
    .select()
    .from(materialRequests)
    .where(eq(materialRequests.id, requestId))
    .limit(1);
  if (!request) {
    throw new Error("Requisición no encontrada");
  }

  if (
    request.status === "borrador" ||
    request.status === "pendiente_aprobar" ||
    request.status === "anulada"
  ) {
    return { success: true, status: request.status, changed: false };
  }

  const items = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.requestId, requestId));
  const activeItems = items.filter(item => item.approvalStatus !== "rechazada");
  if (activeItems.length === 0) {
    return { success: true, status: request.status, changed: false };
  }

  const activeItemIds = activeItems.map(item => item.id);
  const purchaseReceiptRows =
    activeItemIds.length > 0
      ? await db
          .select({
            materialRequestItemId: purchaseOrderItems.materialRequestItemId,
            receivedQuantity: sql<string>`coalesce(sum(${purchaseOrderItems.receivedQuantity}), 0)`,
          })
          .from(purchaseOrderItems)
          .where(
            inArray(purchaseOrderItems.materialRequestItemId, activeItemIds)
          )
          .groupBy(purchaseOrderItems.materialRequestItemId)
      : [];
  const purchaseReceivedByItemId = new Map<number, number>();
  for (const row of purchaseReceiptRows) {
    if (!row.materialRequestItemId) continue;
    purchaseReceivedByItemId.set(
      row.materialRequestItemId,
      parseDecimal(row.receivedQuantity)
    );
  }

  for (const item of activeItems) {
    const purchaseReceivedQuantity = purchaseReceivedByItemId.get(item.id) ?? 0;
    if (purchaseReceivedQuantity <= 0) continue;

    const requested = parseDecimal(item.quantity);
    const nextDelivered = Math.min(
      Math.max(parseDecimal(item.deliveredQuantity), purchaseReceivedQuantity),
      requested
    );
    const fulfilledQuantity = Math.max(
      nextDelivered,
      parseDecimal(item.dispatchedQuantity)
    );
    const nextItemStatus =
      fulfilledQuantity <= 0
        ? "pendiente"
        : fulfilledQuantity < requested
          ? "parcial"
          : "completo";

    if (
      toDecimalString(nextDelivered) !==
        toDecimalString(item.deliveredQuantity) ||
      nextItemStatus !== item.status
    ) {
      await db
        .update(requestItems)
        .set({
          deliveredQuantity: toDecimalString(nextDelivered),
          status: nextItemStatus,
          updatedAt: new Date(),
        })
        .where(eq(requestItems.id, item.id));

      item.deliveredQuantity = toDecimalString(nextDelivered);
      item.status = nextItemStatus;
    }
  }

  const transferClosureRows =
    activeItemIds.length > 0
      ? await db
          .select({
            materialRequestItemId: transferRequestItems.materialRequestItemId,
            quantity: transferRequestItems.quantity,
            receivedQuantity: transferRequestItems.receivedQuantity,
            returnedToOriginQuantity:
              transferRequestItems.returnedToOriginQuantity,
            receiptClosed: transferRequestItems.receiptClosed,
          })
          .from(transferRequestItems)
          .where(
            inArray(transferRequestItems.materialRequestItemId, activeItemIds)
          )
      : [];
  const transferClosureByItemId = new Map<
    number,
    { resolvedQuantity: number; returnedQuantity: number }
  >();

  for (const row of transferClosureRows) {
    if (!row.materialRequestItemId) continue;

    const receivedQuantity = parseDecimal(row.receivedQuantity);
    const returnedQuantity = parseDecimal(row.returnedToOriginQuantity);
    if (!row.receiptClosed && returnedQuantity <= 0) continue;

    const current = transferClosureByItemId.get(row.materialRequestItemId) ?? {
      resolvedQuantity: 0,
      returnedQuantity: 0,
    };
    current.resolvedQuantity += Math.min(
      parseDecimal(row.quantity),
      receivedQuantity + returnedQuantity
    );
    current.returnedQuantity += returnedQuantity;
    transferClosureByItemId.set(row.materialRequestItemId, current);
  }

  const isItemPhysicallyDelivered = (item: (typeof activeItems)[number]) => {
    const requested = parseDecimal(item.quantity);
    if (requested <= 0) return true;
    return parseDecimal(item.dispatchedQuantity) >= requested;
  };

  const isItemClosedIncomplete = (item: (typeof activeItems)[number]) => {
    if (item.assignedFlow !== "traslado_proyecto") return false;

    const requested = parseDecimal(item.quantity);
    if (requested <= 0) return false;

    const closure = transferClosureByItemId.get(item.id);
    return Boolean(
      closure &&
        closure.returnedQuantity > 0 &&
        closure.resolvedQuantity >= requested
    );
  };

  const isItemFlowCompleted = (item: (typeof activeItems)[number]) => {
    const requested = parseDecimal(item.quantity);
    if (requested <= 0) return true;
    return (
      item.status === "completo" ||
      isItemClosedIncomplete(item) ||
      parseDecimal(item.deliveredQuantity) >= requested ||
      parseDecimal(item.dispatchedQuantity) >= requested
    );
  };

  const hasProgress = activeItems.some(
    item =>
      Boolean(item.assignedFlow) ||
      item.status !== "pendiente" ||
      parseDecimal(item.deliveredQuantity) > 0 ||
      parseDecimal(item.dispatchedQuantity) > 0
  );
  const hasAttention = activeItems.some(
    item =>
      item.status !== "pendiente" ||
      parseDecimal(item.deliveredQuantity) > 0 ||
      parseDecimal(item.dispatchedQuantity) > 0
  );
  const hasIncompleteClosure = activeItems.some(isItemClosedIncomplete);
  const hasPendingWarehouseExitForIncompleteClosure = activeItems.some(
    item =>
      isItemClosedIncomplete(item) &&
      parseDecimal(item.deliveredQuantity) >
        parseDecimal(item.dispatchedQuantity)
  );
  const allResolvedWithIncompleteClosure =
    hasIncompleteClosure &&
    !hasPendingWarehouseExitForIncompleteClosure &&
    activeItems.every(
      item => isItemPhysicallyDelivered(item) || isItemClosedIncomplete(item)
    );
  const nextStatus = activeItems.every(isItemPhysicallyDelivered)
    ? "cerrada"
    : allResolvedWithIncompleteClosure
      ? "cerrada_incompleta"
      : activeItems.every(isItemFlowCompleted)
        ? "flujo_completado"
        : hasAttention
          ? "parcialmente_atendida"
          : hasProgress
            ? "en_proceso"
            : "en_espera";

  if (nextStatus === request.status) {
    return { success: true, status: request.status, changed: false };
  }

  await updateMaterialRequestStatus(requestId, nextStatus, processedById);
  return { success: true, status: nextStatus, changed: true };
}

export async function approveMaterialRequest(id: number, approvedById: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(materialRequests)
    .set({
      approvalStatus: "aprobada",
      approvedById,
      approvedAt: new Date(),
      workflowStage: "oficina_central",
      recipient: "oficina_central",
      status: "en_proceso",
      processedById: approvedById,
      processedAt: new Date(),
    })
    .where(eq(materialRequests.id, id));

  return { success: true };
}

export async function rejectMaterialRequest(
  id: number,
  approvedById: number,
  rejectionReason: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(materialRequests)
    .set({
      approvalStatus: "rechazada",
      rejectionReason,
      approvedById,
      approvedAt: new Date(),
      workflowStage: "rechazada",
      recipient: "administrador_proyecto",
      status: "anulada",
      processedById: approvedById,
      processedAt: new Date(),
    })
    .where(eq(materialRequests.id, id));

  return { success: true };
}

export async function reviewMaterialRequestItems(params: {
  requestId: number;
  itemIds: number[];
  approvalStatus: "aprobada" | "rechazada";
  approvedById: number;
  rejectionReason?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const nextRejectionReason =
    params.approvalStatus === "rechazada"
      ? params.rejectionReason?.trim() ||
        "No autorizado por el Administrador del Proyecto o Administración Central"
      : null;

  await db
    .update(requestItems)
    .set({
      approvalStatus: params.approvalStatus,
      approvedById: params.approvedById,
      approvedAt: new Date(),
      rejectionReason: nextRejectionReason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(requestItems.requestId, params.requestId),
        inArray(requestItems.id, params.itemIds)
      )
    );

  return syncMaterialRequestApprovalState(
    params.requestId,
    params.approvedById
  );
}

export async function syncMaterialRequestApprovalState(
  requestId: number,
  processedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [request] = await db
    .select({
      id: materialRequests.id,
      requestType: materialRequests.requestType,
    })
    .from(materialRequests)
    .where(eq(materialRequests.id, requestId))
    .limit(1);

  if (!request) {
    throw new Error("Requisición no encontrada");
  }

  const items = await db
    .select({
      approvalStatus: requestItems.approvalStatus,
    })
    .from(requestItems)
    .where(eq(requestItems.requestId, requestId));

  const pendingCount = items.filter(
    item => item.approvalStatus === "pendiente"
  ).length;
  const approvedCount = items.filter(
    item =>
      item.approvalStatus === "aprobada" ||
      item.approvalStatus === "no_requiere"
  ).length;
  const rejectedCount = items.filter(
    item => item.approvalStatus === "rechazada"
  ).length;
  const now = new Date();

  if (request.requestType !== "bienes") {
    return {
      pendingCount,
      approvedCount,
      rejectedCount,
      requestStatus: null,
      approvalStatus: null,
      workflowStage: null,
    };
  }

  if (pendingCount > 0) {
    await db
      .update(materialRequests)
      .set({
        approvalStatus: "pendiente",
        workflowStage: "administrador_proyecto",
        recipient: "administrador_proyecto",
        status: "pendiente_aprobar",
        rejectionReason: null,
        closedAt: null,
        updatedAt: now,
      })
      .where(eq(materialRequests.id, requestId));

    return {
      pendingCount,
      approvedCount,
      rejectedCount,
      requestStatus: "pendiente_aprobar" as const,
      approvalStatus: "pendiente" as const,
      workflowStage: "administrador_proyecto" as const,
    };
  }

  if (approvedCount > 0) {
    await db
      .update(materialRequests)
      .set({
        approvalStatus: "aprobada",
        workflowStage: "bodega_proyecto",
        recipient: "bodega_proyecto",
        status: "en_espera",
        processedById,
        processedAt: now,
        rejectionReason: null,
        closedAt: null,
        updatedAt: now,
      })
      .where(eq(materialRequests.id, requestId));

    return {
      pendingCount,
      approvedCount,
      rejectedCount,
      requestStatus: "en_espera" as const,
      approvalStatus: "aprobada" as const,
      workflowStage: "bodega_proyecto" as const,
    };
  }

  await db
    .update(materialRequests)
    .set({
      approvalStatus: "rechazada",
      workflowStage: "rechazada",
      recipient: "administrador_proyecto",
      status: "anulada",
      processedById,
      processedAt: now,
      closedAt: now,
      updatedAt: now,
    })
    .where(eq(materialRequests.id, requestId));

  return {
    pendingCount,
    approvedCount,
    rejectedCount,
    requestStatus: "anulada" as const,
    approvalStatus: "rechazada" as const,
    workflowStage: "rechazada" as const,
  };
}

export async function assignFlow(
  requestId: number,
  flowType:
    | "compra_directa"
    | "despacho_bodega"
    | "traslado_proyecto"
    | "solicitud_compra",
  processedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(materialRequests)
    .set({
      assignedFlow: flowType,
      processedById,
      processedAt: new Date(),
      status: "en_proceso",
    })
    .where(eq(materialRequests.id, requestId));

  return { success: true };
}

// ============================================================
// REQUEST ITEMS
// ============================================================
export async function updateRequestItem(
  id: number,
  data: Partial<InsertRequestItem>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(requestItems).set(data).where(eq(requestItems.id, id));
  return { success: true };
}

export async function createRequestItem(data: InsertRequestItem) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .insert(requestItems)
    .values(data)
    .returning({ id: requestItems.id });

  return { id: item.id };
}

export async function getRequestItemsByRequestId(requestId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(requestItems)
    .where(eq(requestItems.requestId, requestId));
}

export async function getRequestItemById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, id))
    .limit(1);

  return item;
}

export async function returnWarehouseDispatchItemToRequisition(params: {
  requestItemId: number;
  processedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  if (!item) {
    throw new Error("Ítem de requisición no encontrado");
  }
  if (item.assignedFlow !== "despacho_bodega") {
    throw new Error(
      "Solo se pueden devolver ítems asignados a salida de bodega"
    );
  }

  const requestedQuantity = parseDecimal(item.quantity);
  const dispatchedQuantity = Math.min(
    Math.max(parseDecimal(item.dispatchedQuantity), 0),
    requestedQuantity
  );
  const pendingQuantity = Math.max(requestedQuantity - dispatchedQuantity, 0);

  if (pendingQuantity <= 0) {
    throw new Error(
      "Este ítem no tiene cantidad pendiente para devolver a requisición"
    );
  }

  const activeDraftFlows = await db
    .select()
    .from(supplyFlowRecords)
    .where(
      and(
        eq(supplyFlowRecords.requestItemId, item.id),
        eq(supplyFlowRecords.flowType, "despacho_bodega"),
        eq(supplyFlowRecords.status, "pendiente"),
        isNotNull(supplyFlowRecords.sapDocumentNumber)
      )
    );
  if (activeDraftFlows.length > 0) {
    throw new Error(
      "Este ítem tiene una salida en borrador. Anule o emita esa salida antes de devolverlo a requisición"
    );
  }

  let returnedItemId = item.id;
  let pendingRequestItemId: number | null = null;

  if (dispatchedQuantity > 0) {
    const deliveredQuantity = Math.min(
      Math.max(parseDecimal(item.deliveredQuantity), 0),
      dispatchedQuantity
    );

    await db
      .update(requestItems)
      .set({
        quantity: toDecimalString(dispatchedQuantity),
        deliveredQuantity: toDecimalString(deliveredQuantity),
        dispatchedQuantity: toDecimalString(dispatchedQuantity),
        assignedFlow: "despacho_bodega",
        status: "completo",
        updatedAt: new Date(),
      })
      .where(eq(requestItems.id, item.id));

    await db
      .update(supplyFlowRecords)
      .set({
        status: "completado",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supplyFlowRecords.requestItemId, item.id),
          eq(supplyFlowRecords.flowType, "despacho_bodega"),
          sql`${supplyFlowRecords.status} <> 'cancelado'`
        )
      );

    const createdItem = await createRequestItem({
      requestId: item.requestId,
      itemName: item.itemName,
      quantity: toDecimalString(pendingQuantity),
      unit: item.unit,
      approvalStatus: item.approvalStatus,
      approvedById: item.approvedById,
      approvedAt: item.approvedAt,
      rejectionReason: item.rejectionReason,
      sapItemCode: item.sapItemCode,
      sapItemDescription: item.sapItemDescription,
      assignedFlow: null,
      warehouseId: null,
      deliveredQuantity: "0.00",
      dispatchedQuantity: "0.00",
      committedQuantity: item.committedQuantity ?? "0.00",
      projectStock: item.projectStock ?? "0.00",
      sapStock: item.sapStock ?? "0.00",
      warehouseExitNote: null,
      status: "pendiente",
      notes: item.notes,
    });
    pendingRequestItemId = createdItem.id;
  } else {
    await db
      .update(requestItems)
      .set({
        assignedFlow: null,
        warehouseId: null,
        status: "pendiente",
        updatedAt: new Date(),
      })
      .where(eq(requestItems.id, item.id));
    returnedItemId = item.id;
    pendingRequestItemId = item.id;
  }

  await syncMaterialRequestFulfillmentStatus(
    item.requestId,
    params.processedById
  );

  return {
    success: true,
    requestId: item.requestId,
    returnedItemId,
    pendingRequestItemId,
    pendingQuantity: toDecimalString(pendingQuantity),
  };
}

export async function returnTransferFlowItemToRequisition(params: {
  requestItemId: number;
  processedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  if (!item) {
    throw new Error("Ítem de requisición no encontrado");
  }
  if (item.assignedFlow !== "traslado_proyecto") {
    throw new Error("Solo se pueden devolver ítems asignados a traslado");
  }

  const activeFlow = await getActiveSupplyFlowForRequestItem({
    requestId: item.requestId,
    requestItemId: item.id,
    flowType: "traslado_proyecto",
  });
  if (activeFlow) {
    throw new Error(
      "Este ítem tiene una solicitud de traslado activa. Anule la ST antes de devolverlo a requisición"
    );
  }

  await db
    .update(requestItems)
    .set({
      assignedFlow: null,
      status: "pendiente",
      updatedAt: new Date(),
    })
    .where(eq(requestItems.id, item.id));

  await syncMaterialRequestFulfillmentStatus(
    item.requestId,
    params.processedById
  );

  return {
    success: true,
    requestId: item.requestId,
    returnedItemId: item.id,
    pendingQuantity: toDecimalString(item.quantity),
  };
}

export async function rejectRequestItemPendingQuantity(params: {
  requestItemId: number;
  rejectedById: number;
  rejectionReason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  if (!item) {
    throw new Error("Ítem de requisición no encontrado");
  }
  if (item.approvalStatus === "rechazada") {
    throw new Error("Este ítem ya fue rechazado");
  }

  const requestedQuantity = parseDecimal(item.quantity);
  const deliveredQuantity = Math.max(parseDecimal(item.deliveredQuantity), 0);
  const dispatchedQuantity = Math.max(parseDecimal(item.dispatchedQuantity), 0);
  const processedQuantity = Math.min(
    Math.max(deliveredQuantity, dispatchedQuantity),
    requestedQuantity
  );
  const pendingQuantity = Math.max(requestedQuantity - processedQuantity, 0);
  if (pendingQuantity <= 0) {
    throw new Error("Este ítem no tiene saldo pendiente para rechazar");
  }

  const reason = params.rejectionReason.trim();
  const rejectionNote = item.notes?.trim()
    ? `${item.notes.trim()}\n\nNota de rechazo de saldo: ${reason}`
    : `Nota de rechazo de saldo: ${reason}`;
  const now = new Date();

  if (processedQuantity <= 0) {
    await db
      .update(requestItems)
      .set({
        approvalStatus: "rechazada",
        approvedById: params.rejectedById,
        approvedAt: now,
        rejectionReason: reason,
        notes: rejectionNote,
        assignedFlow: null,
        status: "pendiente",
        updatedAt: now,
      })
      .where(eq(requestItems.id, item.id));

    await db
      .update(supplyFlowRecords)
      .set({
        status: "cancelado",
        notes: rejectionNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(supplyFlowRecords.requestItemId, item.id),
          sql`${supplyFlowRecords.status} <> 'cancelado'`
        )
      );

    await syncMaterialRequestFulfillmentStatus(
      item.requestId,
      params.rejectedById
    );

    return {
      success: true,
      requestId: item.requestId,
      processedItemId: null,
      rejectedItemId: item.id,
      rejectedQuantity: toDecimalString(pendingQuantity),
    };
  }

  await db
    .update(requestItems)
    .set({
      quantity: toDecimalString(processedQuantity),
      deliveredQuantity: toDecimalString(
        Math.min(deliveredQuantity, processedQuantity)
      ),
      dispatchedQuantity: toDecimalString(
        Math.min(dispatchedQuantity, processedQuantity)
      ),
      status: "completo",
      updatedAt: now,
    })
    .where(eq(requestItems.id, item.id));

  const rejectedItem = await createRequestItem({
    requestId: item.requestId,
    itemName: item.itemName,
    quantity: toDecimalString(pendingQuantity),
    unit: item.unit,
    approvalStatus: "rechazada",
    approvedById: params.rejectedById,
    approvedAt: now,
    rejectionReason: reason,
    sapItemCode: item.sapItemCode,
    sapItemDescription: item.sapItemDescription,
    assignedFlow: null,
    deliveredQuantity: "0.00",
    dispatchedQuantity: "0.00",
    committedQuantity: item.committedQuantity ?? "0.00",
    projectStock: item.projectStock ?? "0.00",
    sapStock: item.sapStock ?? "0.00",
    warehouseExitNote: null,
    status: "pendiente",
    notes: rejectionNote,
  });

  await syncMaterialRequestFulfillmentStatus(
    item.requestId,
    params.rejectedById
  );

  return {
    success: true,
    requestId: item.requestId,
    processedItemId: item.id,
    rejectedItemId: rejectedItem.id,
    rejectedQuantity: toDecimalString(pendingQuantity),
  };
}

export async function rejectApprovedRequestItem(params: {
  requestItemId: number;
  rejectedById: number;
  rejectionReason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  if (!item) {
    throw new Error("Ítem de requisición no encontrado");
  }
  if (item.approvalStatus === "rechazada") {
    throw new Error("Este ítem ya fue rechazado");
  }
  if (
    item.approvalStatus !== "aprobada" &&
    item.approvalStatus !== "no_requiere"
  ) {
    throw new Error("Solo se pueden rechazar ítems aprobados");
  }
  if (
    parseDecimal(item.deliveredQuantity) > 0 ||
    parseDecimal(item.dispatchedQuantity) > 0
  ) {
    throw new Error(
      "Este ítem ya tiene movimientos y no se puede rechazar completo"
    );
  }
  if (item.assignedFlow) {
    throw new Error("Quite el flujo asignado antes de rechazar este ítem");
  }

  const activeFlows = await db
    .select()
    .from(supplyFlowRecords)
    .where(
      and(
        eq(supplyFlowRecords.requestItemId, item.id),
        sql`${supplyFlowRecords.status} <> 'cancelado'`
      )
    );
  if (activeFlows.length > 0) {
    throw new Error(
      "Este ítem tiene movimientos de flujo activos y no se puede rechazar"
    );
  }

  const reason = params.rejectionReason.trim();
  const rejectionNote = item.notes?.trim()
    ? `${item.notes.trim()}\n\nNota de rechazo administrativo: ${reason}`
    : `Nota de rechazo administrativo: ${reason}`;
  const now = new Date();

  await db
    .update(requestItems)
    .set({
      approvalStatus: "rechazada",
      approvedById: params.rejectedById,
      approvedAt: now,
      rejectionReason: reason,
      notes: rejectionNote,
      assignedFlow: null,
      status: "pendiente",
      updatedAt: now,
    })
    .where(eq(requestItems.id, item.id));

  const remainingItems = await db
    .select({ approvalStatus: requestItems.approvalStatus })
    .from(requestItems)
    .where(eq(requestItems.requestId, item.requestId));
  const remainingApprovedCount = remainingItems.filter(
    entry =>
      entry.approvalStatus === "aprobada" ||
      entry.approvalStatus === "no_requiere"
  ).length;

  if (remainingApprovedCount > 0) {
    await syncMaterialRequestFulfillmentStatus(
      item.requestId,
      params.rejectedById
    );
  } else {
    await syncMaterialRequestApprovalState(item.requestId, params.rejectedById);
  }

  return {
    success: true,
    requestId: item.requestId,
    rejectedItemId: item.id,
    rejectedQuantity: toDecimalString(item.quantity),
  };
}

export async function recordWarehouseExit(params: {
  requestId: number;
  requestItemId: number;
  quantity: string;
  warehouseId?: number | null;
  note?: string;
  receivedByName?: string | null;
  processedById: number;
}) {
  const created = await recordWarehouseExitBatch({
    requestId: params.requestId,
    items: [
      {
        requestItemId: params.requestItemId,
        quantity: params.quantity,
        warehouseId: params.warehouseId,
      },
    ],
    note: params.note,
    receivedByName: params.receivedByName,
    processedById: params.processedById,
  });

  return {
    success: true,
    id: created.id,
    exitNumber: created.exitNumber,
    status: created.status,
  };
}

export async function recordWarehouseExitBatch(params: {
  requestId: number;
  destinationProjectId?: number | null;
  destinationWarehouseId?: number | null;
  items: Array<{
    requestItemId: number;
    quantity: string;
    sourceProjectId?: number | null;
    warehouseId?: number | null;
    destinationProjectId?: number | null;
    destinationWarehouseId?: number | null;
    targetType?: "subproyecto" | "activo_fijo" | null;
    subProjectId?: number | null;
    fixedAssetSapItemCode?: string | null;
    fixedAssetName?: string | null;
  }>;
  note?: string;
  receivedByName?: string | null;
  processedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  if (params.items.length === 0) {
    throw new Error("Debe registrar al menos un ítem");
  }

  const requestItemIds = params.items.map(item => item.requestItemId);
  const uniqueRequestItemIds = Array.from(new Set(requestItemIds));
  if (uniqueRequestItemIds.length !== requestItemIds.length) {
    throw new Error("No se puede repetir el mismo ítem en una salida");
  }

  const [request] = await db
    .select({
      projectId: materialRequests.projectId,
    })
    .from(materialRequests)
    .where(eq(materialRequests.id, params.requestId))
    .limit(1);

  if (!request) {
    throw new Error("Requisición no encontrada");
  }
  const getEntrySourceProjectId = (entry: {
    sourceProjectId?: number | null;
  }) => {
    const sourceProjectId = Number(entry.sourceProjectId ?? 0);
    return Number.isInteger(sourceProjectId) && sourceProjectId > 0
      ? sourceProjectId
      : request.projectId;
  };
  const sourceProjectIds = Array.from(
    new Set(params.items.map(entry => getEntrySourceProjectId(entry)))
  );
  if (sourceProjectIds.length > 1) {
    throw new Error(
      "Seleccione ítems de una misma bodega/proyecto origen para crear la salida"
    );
  }
  const warehouseExitProjectId = sourceProjectIds[0] ?? request.projectId;

  const selectedItems = await db
    .select()
    .from(requestItems)
    .where(inArray(requestItems.id, uniqueRequestItemIds));
  const itemById = new Map(selectedItems.map(item => [item.id, item]));
  const transferSourceWarehouseRows =
    uniqueRequestItemIds.length > 0
      ? await db
          .select({
            materialRequestItemId: transferRequestItems.materialRequestItemId,
            sourceProjectId: transferRequests.projectId,
            sourceWarehouseId: transferRequestItems.sourceWarehouseId,
          })
          .from(transferRequestItems)
          .innerJoin(
            transferRequests,
            eq(transferRequestItems.transferRequestId, transferRequests.id)
          )
          .where(
            and(
              inArray(
                transferRequestItems.materialRequestItemId,
                uniqueRequestItemIds
              ),
              isNotNull(transferRequestItems.sourceWarehouseId),
              inArray(transferRequests.status, [
                "pendiente",
                "aprobada",
                "convertida",
              ])
            )
          )
      : [];
  const transferSourceScopesByItemId = new Map<number, Set<string>>();
  for (const row of transferSourceWarehouseRows) {
    if (!row.materialRequestItemId || !row.sourceWarehouseId) continue;
    const sourceProjectId = row.sourceProjectId ?? request.projectId;
    const sourceScopes =
      transferSourceScopesByItemId.get(row.materialRequestItemId) ??
      new Set<string>();
    sourceScopes.add(`${sourceProjectId}:${row.sourceWarehouseId}`);
    transferSourceScopesByItemId.set(
      row.materialRequestItemId,
      sourceScopes
    );
  }

  for (const requestItemId of uniqueRequestItemIds) {
    const item = itemById.get(requestItemId);
    if (!item) {
      throw new Error("Ítem de requisición no encontrado");
    }
    if (item.requestId !== params.requestId) {
      throw new Error(
        "Todos los ítems de la salida deben pertenecer a la misma requisición"
      );
    }

    const quantity = params.items.find(
      entry => entry.requestItemId === requestItemId
    )?.quantity;
    const dispatchedQuantity = parseDecimal(quantity);
    const pendingQuantity = getWarehouseExitPendingQuantityForRequestItem(item);

    if (dispatchedQuantity <= 0) {
      throw new Error(
        `La cantidad despachada de ${item.itemName} debe ser mayor que cero`
      );
    }
    if (dispatchedQuantity - pendingQuantity > 0.000001) {
      throw new Error(
        `La cantidad despachada de ${item.itemName} no puede exceder la cantidad recibida disponible para salida`
      );
    }
    if (!item.sapItemCode?.trim()) {
      throw new Error(`El ítem ${item.itemName} no tiene código SAP`);
    }
  }

  const requestedByStockKey = new Map<
    string,
    {
      sapItemCode: string | null;
      itemName: string;
      sourceProjectId: number;
      warehouseId: number;
      quantity: number;
    }
  >();
  for (const entry of params.items) {
    const item = itemById.get(entry.requestItemId)!;
    if (!entry.warehouseId) {
      throw new Error(`Seleccione almacén origen para ${item.itemName}`);
    }
    const sourceProjectId = getEntrySourceProjectId(entry);
    if (
      transferSourceScopesByItemId
        .get(entry.requestItemId)
        ?.has(`${sourceProjectId}:${entry.warehouseId}`)
    ) {
      throw new Error(
        `${item.itemName}: no se puede despachar desde la misma bodega/proyecto de origen del traslado`
      );
    }
    const assignment = await resolveProjectAssignment(
      sourceProjectId,
      entry.warehouseId
    );
    if (!assignment) {
      throw new Error(
        `Seleccione un almacén activo de la bodega/proyecto origen para ${item.itemName}`
      );
    }
    const sapItemCode = item.sapItemCode?.trim() || null;
    const stockKey = `${
      sapItemCode || item.itemName.trim().toLowerCase()
    }::${sourceProjectId}::${entry.warehouseId}`;
    const current = requestedByStockKey.get(stockKey) ?? {
      sapItemCode,
      itemName: item.itemName,
      sourceProjectId,
      warehouseId: entry.warehouseId,
      quantity: 0,
    };
    current.quantity += parseDecimal(entry.quantity);
    requestedByStockKey.set(stockKey, current);
  }

  for (const requested of Array.from(requestedByStockKey.values())) {
    const availableQuantity = parseDecimal(
      await getStockByItem({
        sapItemCode: requested.sapItemCode,
        itemName: requested.itemName,
        projectId: requested.sourceProjectId,
        warehouseId: requested.warehouseId,
      })
    );

    if (requested.quantity - availableQuantity > 0.000001) {
      throw new Error(
        `Stock insuficiente para ${requested.itemName}. Disponible: ${toDecimalString(
          availableQuantity
        )}, solicitado para salida: ${toDecimalString(requested.quantity)}.`
      );
    }
  }

  const existingDraftRows = await db
    .select({
      flow: supplyFlowRecords,
      warehouseExit: warehouseExits,
    })
    .from(supplyFlowRecords)
    .innerJoin(
      warehouseExits,
      eq(supplyFlowRecords.sapDocumentNumber, warehouseExits.exitNumber)
    )
    .where(
      and(
        eq(supplyFlowRecords.requestId, params.requestId),
        inArray(supplyFlowRecords.requestItemId, uniqueRequestItemIds),
        eq(supplyFlowRecords.flowType, "despacho_bodega"),
        eq(supplyFlowRecords.status, "pendiente"),
        isNotNull(supplyFlowRecords.sapDocumentNumber),
        eq(warehouseExits.materialRequestId, params.requestId),
        eq(warehouseExits.status, "borrador")
      )
    );

  if (existingDraftRows[0]) {
    throw new Error(
      `Ya existe la salida en borrador ${existingDraftRows[0].warehouseExit.exitNumber} para este ítem. Abra o anule ese borrador antes de crear una nueva.`
    );
  }

  const targetByRequestItemId = new Map<
    number,
    Awaited<ReturnType<typeof resolveWarehouseExitItemTarget>>
  >();
  const destinationByRequestItemId = new Map<
    number,
    { projectId: number; warehouseId: number } | null
  >();
  for (const entry of params.items) {
    const item = itemById.get(entry.requestItemId)!;
    const hasExplicitDestinationScope =
      entry.destinationProjectId != null ||
      entry.destinationWarehouseId != null ||
      params.destinationProjectId != null ||
      params.destinationWarehouseId != null;
    if (hasExplicitDestinationScope) {
      const destinationProjectId =
        entry.destinationProjectId ?? params.destinationProjectId ?? null;
      const destinationWarehouseId =
        entry.destinationWarehouseId ?? params.destinationWarehouseId ?? null;
      const destinationAssignment = await resolveProjectAssignment(
        destinationProjectId,
        destinationWarehouseId
      );
      if (!destinationAssignment) {
        throw new Error(
          `Seleccione almacén destino y bodega/proyecto destino para ${item.itemName}`
        );
      }
      destinationByRequestItemId.set(entry.requestItemId, {
        projectId: destinationAssignment.projectId,
        warehouseId: destinationAssignment.warehouseId,
      });
    } else {
      destinationByRequestItemId.set(entry.requestItemId, null);
    }

    const hasExplicitTarget =
      entry.targetType !== undefined ||
      entry.subProjectId !== undefined ||
      entry.fixedAssetSapItemCode !== undefined ||
      entry.fixedAssetName !== undefined;
    targetByRequestItemId.set(
      entry.requestItemId,
      await resolveWarehouseExitItemTarget({
        projectId: request.projectId,
        itemName: item.sapItemDescription || item.itemName,
        targetType: hasExplicitTarget ? entry.targetType : item.targetType,
        subProjectId: hasExplicitTarget
          ? entry.subProjectId
          : item.subProjectId,
        fixedAssetSapItemCode: hasExplicitTarget
          ? entry.fixedAssetSapItemCode
          : item.fixedAssetSapItemCode,
        fixedAssetName: hasExplicitTarget
          ? entry.fixedAssetName
          : item.fixedAssetName,
      })
    );
  }

  const created = await createWarehouseExit(
    {
      projectId: warehouseExitProjectId,
      destinationProjectId: params.destinationProjectId ?? undefined,
      destinationWarehouseId: params.destinationWarehouseId ?? undefined,
      materialRequestId: params.requestId,
      createdById: params.processedById,
      status: "borrador",
      exitDate: new Date(),
      notes: params.note,
      receivedByName: params.receivedByName?.trim() || null,
    },
    params.items.map(entry => {
      const item = itemById.get(entry.requestItemId)!;
      const target = targetByRequestItemId.get(entry.requestItemId)!;
      const destination = destinationByRequestItemId.get(entry.requestItemId);
      return {
        materialRequestItemId: entry.requestItemId,
        warehouseId: entry.warehouseId,
        ...(destination
          ? {
              destinationProjectId: destination.projectId,
              destinationWarehouseId: destination.warehouseId,
            }
          : {}),
        sapItemCode: item.sapItemCode ?? "",
        itemName: item.sapItemDescription || item.itemName,
        quantity: entry.quantity,
        unit: item.unit,
        ...target,
        notes: params.note,
      };
    })
  );

  await db.insert(supplyFlowRecords).values(
    params.items.map(entry => ({
      requestId: params.requestId,
      requestItemId: entry.requestItemId,
      flowType: "despacho_bodega" as const,
      sourceWarehouse: "Bodega del Proyecto",
      sapDocumentType: "salida_inventario" as const,
      sapDocumentNumber: created.exitNumber,
      processedById: params.processedById,
      notes: params.note ?? null,
      status: "pendiente" as const,
    }))
  );

  return {
    success: true,
    id: created.id,
    exitNumber: created.exitNumber,
    status: "borrador",
    itemCount: params.items.length,
  };
}

// ============================================================
// SUPPLY FLOW RECORDS
// ============================================================
export async function createSupplyFlowRecord(data: InsertSupplyFlowRecord) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [flowRecord] = await db
    .insert(supplyFlowRecords)
    .values(data)
    .returning({ id: supplyFlowRecords.id });
  return { id: flowRecord.id };
}

export async function getSupplyFlowByRequestId(requestId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(supplyFlowRecords)
    .where(eq(supplyFlowRecords.requestId, requestId))
    .orderBy(desc(supplyFlowRecords.createdAt));
}

export async function getSupplyFlowRecordById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      flow: supplyFlowRecords,
      request: materialRequests,
      project: projects,
    })
    .from(supplyFlowRecords)
    .leftJoin(
      materialRequests,
      eq(supplyFlowRecords.requestId, materialRequests.id)
    )
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(eq(supplyFlowRecords.id, id))
    .limit(1);

  return rows[0];
}

export async function listDirectPurchaseFlowItemsByOrder(params: {
  purchaseOrderNumber: string;
  sapItemCode?: string | null;
  requestItemIds?: number[];
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    eq(supplyFlowRecords.flowType, "compra_directa"),
    eq(supplyFlowRecords.purchaseOrderNumber, params.purchaseOrderNumber),
    isNotNull(supplyFlowRecords.requestItemId),
    sql`${supplyFlowRecords.status} <> 'cancelado'`,
  ];

  if (params.sapItemCode?.trim()) {
    conditions.push(eq(requestItems.sapItemCode, params.sapItemCode.trim()));
  }
  if (params.requestItemIds?.length) {
    conditions.push(inArray(requestItems.id, params.requestItemIds));
  }

  return db
    .select({
      flow: supplyFlowRecords,
      item: requestItems,
    })
    .from(supplyFlowRecords)
    .innerJoin(
      requestItems,
      eq(supplyFlowRecords.requestItemId, requestItems.id)
    )
    .where(and(...conditions))
    .orderBy(desc(supplyFlowRecords.createdAt), asc(requestItems.id));
}

export async function updateSupplyFlowRecord(
  id: number,
  data: Partial<InsertSupplyFlowRecord>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(supplyFlowRecords)
    .set(data)
    .where(eq(supplyFlowRecords.id, id));
  return { success: true };
}

export async function listSupplyFlowRecords(filters?: {
  flowType?: string;
  status?: string;
  requestedById?: number;
  projectId?: number;
  projectIds?: number[];
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.flowType)
    conditions.push(eq(supplyFlowRecords.flowType, filters.flowType as any));
  if (filters?.status)
    conditions.push(eq(supplyFlowRecords.status, filters.status as any));
  if (filters?.requestedById) {
    conditions.push(eq(materialRequests.requestedById, filters.requestedById));
  }
  if (filters?.projectId) {
    conditions.push(eq(materialRequests.projectId, filters.projectId));
  }
  if (filters?.projectIds) {
    applyProjectScope(
      conditions,
      materialRequests.projectId,
      filters.projectIds
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      flow: supplyFlowRecords,
      request: materialRequests,
      project: projects,
    })
    .from(supplyFlowRecords)
    .leftJoin(
      materialRequests,
      eq(supplyFlowRecords.requestId, materialRequests.id)
    )
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(where)
    .orderBy(desc(supplyFlowRecords.createdAt));
}

export async function listPendingFlowQueueItems(filters?: {
  flowType?: string;
  requestedById?: number;
  projectId?: number;
  projectIds?: number[];
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    isNotNull(requestItems.assignedFlow),
    sql`${materialRequests.status} NOT IN ('borrador', 'flujo_completado', 'cerrada', 'cerrada_incompleta', 'anulada')`,
    sql`${requestItems.approvalStatus} IN ('aprobada', 'no_requiere')`,
  ];

  if (filters?.flowType) {
    conditions.push(eq(requestItems.assignedFlow, filters.flowType as any));
  }
  if (filters?.requestedById) {
    conditions.push(eq(materialRequests.requestedById, filters.requestedById));
  }
  if (filters?.projectId) {
    conditions.push(eq(materialRequests.projectId, filters.projectId));
  }
  if (filters?.projectIds) {
    applyProjectScope(
      conditions,
      materialRequests.projectId,
      filters.projectIds
    );
  }

  const candidateRows = await db
    .select({
      item: requestItems,
      request: materialRequests,
      project: projects,
    })
    .from(requestItems)
    .innerJoin(
      materialRequests,
      eq(requestItems.requestId, materialRequests.id)
    )
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(
      asc(requestItems.assignedFlow),
      desc(materialRequests.createdAt),
      asc(materialRequests.requestNumber),
      asc(requestItems.id)
    );

  const requestItemIds = candidateRows
    .map(row => row.item.id)
    .filter((value): value is number => typeof value === "number");

  if (requestItemIds.length === 0) {
    return [];
  }

  const sapCodes = candidateRows
    .map(row => row.item.sapItemCode?.trim())
    .filter((value): value is string => Boolean(value));

  const [activeFlows, procurementInsightsByCode] = await Promise.all([
    db
      .select()
      .from(supplyFlowRecords)
      .where(
        and(
          isNotNull(supplyFlowRecords.requestItemId),
          inArray(supplyFlowRecords.requestItemId, requestItemIds),
          sql`${supplyFlowRecords.status} <> 'cancelado'`
        )
      ),
    getSapProcurementInsightsByCodes(sapCodes),
  ]);

  const activeFlowsByItemId = new Map<number, typeof activeFlows>();
  for (const flow of activeFlows) {
    if (!flow.requestItemId) continue;
    const current = activeFlowsByItemId.get(flow.requestItemId) ?? [];
    current.push(flow);
    activeFlowsByItemId.set(flow.requestItemId, current);
  }

  const filteredRows = candidateRows.filter(row => {
    const assignedFlow = row.item.assignedFlow;
    if (!assignedFlow) return false;

    if (assignedFlow === "despacho_bodega") {
      const hasDraftExit = (activeFlowsByItemId.get(row.item.id) ?? []).some(
        flow =>
          flow.flowType === "despacho_bodega" &&
          flow.status === "pendiente" &&
          Boolean(flow.sapDocumentNumber)
      );
      if (hasDraftExit) return false;

      return (
        parseDecimal(row.item.dispatchedQuantity) <
        parseDecimal(row.item.quantity)
      );
    }

    const activeForSameFlow = (activeFlowsByItemId.get(row.item.id) ?? []).some(
      flow => flow.flowType === assignedFlow
    );

    return !activeForSameFlow;
  });

  return Promise.all(
    filteredRows.map(async row => {
      const sapCode = row.item.sapItemCode?.trim() || null;
      const insight = sapCode ? procurementInsightsByCode[sapCode] : undefined;
      const resolvedSapDescription =
        row.item.sapItemDescription?.trim() || insight?.sapDescription || null;
      const dispatchStock =
        row.item.assignedFlow === "despacho_bodega"
          ? await (async () => {
              const projectWarehouses = await listProjectWarehouses(
                row.request.projectId,
                { isActive: true }
              );
              const warehouseIds = projectWarehouses.map(
                warehouse => warehouse.id
              );
              const [stock] = await listVisibleWarehouseStockForItems({
                warehouseIds,
                items: [
                  {
                    id: row.item.id,
                    sapItemCode: sapCode,
                    itemName: row.item.itemName,
                  },
                ],
              });
              return stock;
            })()
          : null;

      return {
        ...row,
        item: {
          ...row.item,
          sapItemDescription: resolvedSapDescription,
          projectStock:
            row.item.assignedFlow === "despacho_bodega"
              ? (dispatchStock?.quantity ?? "0.00")
              : row.item.projectStock,
          projectStockWarehouses:
            row.item.assignedFlow === "despacho_bodega"
              ? (dispatchStock?.warehouses ?? [])
              : [],
          dispatchStock:
            row.item.assignedFlow === "despacho_bodega"
              ? (dispatchStock?.quantity ?? "0.00")
              : null,
          dispatchStockOptions:
            row.item.assignedFlow === "despacho_bodega"
              ? (dispatchStock?.warehouses ?? [])
              : [],
        },
        purchaseInsight: {
          sapDescription: resolvedSapDescription,
          lastPurchase: insight?.lastPurchase ?? null,
          minimumPurchase: insight?.minimumPurchase ?? null,
        },
      };
    })
  );
}

export async function getActiveSupplyFlowForRequestItem(params: {
  requestId: number;
  requestItemId: number;
  flowType:
    | "compra_directa"
    | "despacho_bodega"
    | "traslado_proyecto"
    | "solicitud_compra";
}) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(supplyFlowRecords)
    .where(
      and(
        eq(supplyFlowRecords.requestId, params.requestId),
        eq(supplyFlowRecords.requestItemId, params.requestItemId),
        eq(supplyFlowRecords.flowType, params.flowType),
        sql`${supplyFlowRecords.status} <> 'cancelado'`
      )
    )
    .orderBy(desc(supplyFlowRecords.createdAt))
    .limit(1);

  return rows[0];
}

// ============================================================
// AUTO-NUMBERING: Purchase Orders
// ============================================================
export async function generatePurchaseOrderNumber(
  projectId: number,
  classification: "oc" | "cd" = "oc"
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error("Proyecto no encontrado para correlativo");
  }

  const projectCode = project.code.trim();
  if (!projectCode) {
    throw new Error("El proyecto no tiene código para correlativo");
  }

  const sequencePrefixes = ["OC", "CD"];
  const documentPrefixes = sequencePrefixes.map(
    prefix => `${prefix}-${projectCode}-`
  );
  const [legacyRows, orderRows] = await Promise.all([
    db
      .select({ documentNumber: supplyFlowRecords.purchaseOrderNumber })
      .from(supplyFlowRecords)
      .where(
        and(
          isNotNull(supplyFlowRecords.purchaseOrderNumber),
          or(
            ...documentPrefixes.map(documentPrefix =>
              ilike(supplyFlowRecords.purchaseOrderNumber, `${documentPrefix}%`)
            )
          )
        )
      ),
    db
      .select({ documentNumber: purchaseOrders.orderNumber })
      .from(purchaseOrders)
      .where(
        or(
          ...documentPrefixes.map(documentPrefix =>
            ilike(purchaseOrders.orderNumber, `${documentPrefix}%`)
          )
        )
      ),
  ]);

  return buildProjectScopedDocumentNumber({
    prefix: classification === "cd" ? "CD" : "OC",
    projectCode,
    existingNumbers: [
      ...legacyRows.map(row => row.documentNumber),
      ...orderRows.map(row => row.documentNumber),
    ],
    sequencePrefixes,
  });
}

export async function generatePurchaseRequestNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "SC",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: purchaseRequests.requestNumber })
        .from(purchaseRequests)
        .where(ilike(purchaseRequests.requestNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateTransferRequestNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "ST",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: transferRequests.requestNumber })
        .from(transferRequests)
        .where(ilike(transferRequests.requestNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateTransferNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "TR",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: transfers.transferNumber })
        .from(transfers)
        .where(ilike(transfers.transferNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateRemissionGuideNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "GR",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: remissionGuides.guideNumber })
        .from(remissionGuides)
        .where(ilike(remissionGuides.guideNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateReceiptNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "RE",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: receipts.receiptNumber })
        .from(receipts)
        .where(ilike(receipts.receiptNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateInvoiceDocumentNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "FT",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: invoices.invoiceDocumentNumber })
        .from(invoices)
        .where(ilike(invoices.invoiceDocumentNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateWarehouseExitNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "SB",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: warehouseExits.exitNumber })
        .from(warehouseExits)
        .where(ilike(warehouseExits.exitNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

export async function generateOpeningBalanceNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "SI",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: openingBalances.balanceNumber })
        .from(openingBalances)
        .where(ilike(openingBalances.balanceNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

function buildPurchaseRequestDocument(params: {
  requestNumber: string;
  projectLabel: string;
  purchaseType: string;
  neededBy: Date | string | null | undefined;
  printedAt?: Date | string | null | undefined;
  items: Array<{
    itemName: string;
    quantity: string | number;
    unit?: string | null;
    unitPrice?: string | number | null;
  }>;
}) {
  return buildProcurementPdfBase64({
    title: "Solicitud de Compra",
    documentNumber: params.requestNumber,
    badgeText: "SC",
    primaryFields: [
      {
        label: "Proyecto",
        value: params.projectLabel,
      },
      {
        label: "Tipo de compra",
        value: params.purchaseType,
      },
    ],
    secondaryFields: [
      {
        label: "Fecha necesaria",
        value: formatDateLabel(params.neededBy),
      },
      {
        label: "Generado",
        value: formatDateLabel(params.printedAt ?? new Date()),
      },
      {
        label: "Items",
        value: `${params.items.length} registrados`,
      },
    ],
    items: params.items.map(item => ({
      description: item.itemName,
      quantityLabel: `${item.quantity} ${item.unit ?? ""}`.trim(),
    })),
    generatedLabel: formatDateLabel(params.printedAt ?? new Date()),
    footerNote: "Solicitud generada automáticamente por BuildReq.",
  });
}

async function getPreferredSupplierSalesContact(params: {
  supplierId?: number | null;
  projectId?: number | null;
}) {
  if (!params.supplierId) return null;

  const projectContacts = params.projectId
    ? await listSupplierContacts({
        supplierId: params.supplierId,
        projectId: params.projectId,
      })
    : [];
  const contactRows =
    projectContacts.length > 0
      ? projectContacts
      : await listSupplierContacts({ supplierId: params.supplierId });

  return (
    contactRows.find(row => row.contact.contactType === "ventas")?.contact ??
    contactRows[0]?.contact ??
    null
  );
}

type SupplierContactReference = {
  id?: number | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

function buildSupplierContactSnapshot(
  contact: SupplierContactReference | null | undefined
) {
  return {
    supplierContactId: contact?.id ?? null,
    salesAdvisorName: contact?.name?.trim() || null,
    salesAdvisorPhone: contact?.phone?.trim() || null,
    salesAdvisorEmail: contact?.email?.trim() || null,
  };
}

function buildPurchaseOrderSalesAdvisorContact(
  purchaseOrder: typeof purchaseOrders.$inferSelect,
  contact: typeof supplierContacts.$inferSelect | null | undefined
) {
  const name = purchaseOrder.salesAdvisorName?.trim() || contact?.name || "";
  if (!name) return null;

  return {
    id: purchaseOrder.supplierContactId ?? contact?.id ?? null,
    supplierId: contact?.supplierId ?? purchaseOrder.supplierId ?? null,
    projectId: contact?.projectId ?? purchaseOrder.projectId,
    contactType: contact?.contactType ?? "ventas",
    branchName: contact?.branchName ?? null,
    name,
    phone: purchaseOrder.salesAdvisorPhone?.trim() || contact?.phone || null,
    email: purchaseOrder.salesAdvisorEmail?.trim() || contact?.email || null,
    address: contact?.address ?? null,
    isActive: contact?.isActive ?? true,
  };
}

function formatSupplierContactReference(
  contact: SupplierContactReference | null | undefined
) {
  if (!contact) return "-";

  return (
    [contact.name, contact.phone, contact.email]
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join(" / ") || "-"
  );
}

function buildPurchaseOrderItemDestinationLabel(item: {
  target?: {
    type?: "subproyecto" | "activo_fijo" | string | null;
    label?: string | null;
    subProjectId?: number | null;
    fixedAssetSapItemCode?: string | null;
    fixedAssetName?: string | null;
  } | null;
  targetLabel?: string | null;
  targetType?: "subproyecto" | "activo_fijo" | null;
  subProjectId?: number | null;
  fixedAssetSapItemCode?: string | null;
  fixedAssetName?: string | null;
}) {
  const explicitLabel = item.targetLabel?.trim() || item.target?.label?.trim();
  if (explicitLabel) return explicitLabel;

  const targetType = item.target?.type ?? item.targetType;
  if (targetType === "subproyecto") {
    const subProjectId = item.target?.subProjectId ?? item.subProjectId;
    return subProjectId ? `Subproyecto #${subProjectId}` : "-";
  }

  if (targetType === "activo_fijo") {
    const code =
      item.target?.fixedAssetSapItemCode ?? item.fixedAssetSapItemCode;
    const name = item.target?.fixedAssetName ?? item.fixedAssetName;
    if (!code) return "-";
    return name ? `Activo fijo: ${code} - ${name}` : `Activo fijo: ${code}`;
  }

  return "-";
}

function buildPurchaseOrderDocument(params: {
  orderNumber: string;
  orderId?: string | number | null;
  classification: string;
  status?: string | null;
  projectLabel: string;
  supplierLabel: string;
  createdAt?: Date | string | null | undefined;
  neededBy: Date | string | null | undefined;
  printedAt?: Date | string | null | undefined;
  requestedByLabel?: string | null;
  originalRequestLabel?: string | null;
  salesAdvisorLabel?: string | null;
  observations?: string | null;
  quoteLabel?: string | null;
  items: Array<{
    itemName: string;
    currentSapItemCode?: string | null;
    originalSapItemCode?: string | null;
    brand?: string | null;
    partNumber?: string | null;
    quantity: string | number;
    unit?: string | null;
    unitPrice?: string | number | null;
    taxCode?: string | null;
    additionalTaxCodes?: string[] | string | null;
    taxBreakdown?: PurchaseOrderTaxBreakdownEntry[] | string | null;
    target?: {
      type?: "subproyecto" | "activo_fijo" | string | null;
      label?: string | null;
      subProjectId?: number | null;
      fixedAssetSapItemCode?: string | null;
      fixedAssetName?: string | null;
    } | null;
    targetLabel?: string | null;
    targetType?: "subproyecto" | "activo_fijo" | null;
    subProjectId?: number | null;
    fixedAssetSapItemCode?: string | null;
    fixedAssetName?: string | null;
  }>;
}) {
  const summary = summarizePurchaseOrderLines(
    params.items.map(item => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
      additionalTaxCodes: item.additionalTaxCodes,
      taxBreakdown: item.taxBreakdown,
    }))
  );

  return buildPurchaseOrderPrintPdfBase64({
    orderNumber: params.orderNumber,
    orderId: String(params.orderId ?? params.orderNumber),
    projectLabel: params.projectLabel,
    supplierLabel: params.supplierLabel,
    createdDateLabel: formatPrintDateLabel(
      params.createdAt ?? params.printedAt ?? new Date()
    ),
    deliveryDateLabel: params.neededBy
      ? formatPrintDateLabel(params.neededBy)
      : "INMEDIATA",
    requestedByLabel: params.requestedByLabel?.trim() || "-",
    originalRequestLabel: params.originalRequestLabel?.trim() || "-",
    salesAdvisorLabel: params.salesAdvisorLabel?.trim() || "-",
    observations: params.observations?.trim() || "-",
    quoteLabel: params.quoteLabel?.trim() || "-",
    items: params.items.map((item, index) => {
      const amounts = calculatePurchaseOrderLineAmounts({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxCode: item.taxCode,
        additionalTaxCodes: item.additionalTaxCodes,
        taxBreakdown: item.taxBreakdown,
      });

      return {
        itemNumber: String(index + 1),
        description: item.brand
          ? `${item.itemName} | Marca: ${item.brand}`
          : item.itemName,
        destinationLabel: buildPurchaseOrderItemDestinationLabel(item),
        partNumber:
          item.partNumber ||
          item.currentSapItemCode ||
          item.originalSapItemCode ||
          "-",
        quantityLabel: formatPrintNumberLabel(item.quantity),
        unitPriceLabel: formatPrintMoneyLabel(item.unitPrice),
        subtotalLabel: formatPrintMoneyLabel(amounts.subtotal),
      };
    }),
    summaryRows: getPurchaseOrderFiscalSummaryRows(summary).map(row => ({
      label: row.label,
      value: formatPrintMoneyLabel(row.value),
      emphasized: row.emphasized,
    })),
  });
}

function getPurchaseTypeLabel(purchaseType?: string | null) {
  if (purchaseType === "local") return "Compra Local";
  if (purchaseType === "extranjera") return "Compra Extranjera";
  if (purchaseType === "compra_directa") return "Compra Directa";
  return "—";
}

type PurchaseRequestItemInsertInput = Omit<
  InsertPurchaseRequestItem,
  "purchaseRequestId"
>;

function normalizeOptionalText(value: string | null | undefined) {
  return value?.trim() || null;
}

function getPurchaseRequestItemCatalogCodes(
  item: PurchaseRequestItemInsertInput
) {
  return [item.currentSapItemCode, item.originalSapItemCode]
    .map(normalizeOptionalText)
    .filter((value): value is string => Boolean(value));
}

async function resolvePurchaseRequestItemBrands(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  items: PurchaseRequestItemInsertInput[]
) {
  if (items.length === 0) return items;

  const catalogCodes = Array.from(
    new Set(
      items
        .filter(item => !normalizeOptionalText(item.brand))
        .flatMap(getPurchaseRequestItemCatalogCodes)
    )
  );
  if (catalogCodes.length === 0) {
    return items.map(item => ({
      ...item,
      brand: normalizeOptionalText(item.brand),
    }));
  }

  const catalogRows = await database
    .select({
      itemCode: sapCatalog.itemCode,
      brand: sapCatalog.brand,
    })
    .from(sapCatalog)
    .where(inArray(sapCatalog.itemCode, catalogCodes));
  const brandByItemCode = new Map(
    catalogRows
      .map(row => [row.itemCode, normalizeOptionalText(row.brand)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );

  return items.map(item => {
    const existingBrand = normalizeOptionalText(item.brand);
    if (existingBrand) return { ...item, brand: existingBrand };

    const resolvedBrand =
      getPurchaseRequestItemCatalogCodes(item)
        .map(code => brandByItemCode.get(code))
        .find((value): value is string => Boolean(value)) ?? null;

    return resolvedBrand ? { ...item, brand: resolvedBrand } : item;
  });
}

export async function createPurchaseRequest(
  data: Omit<InsertPurchaseRequest, "requestNumber">,
  items: PurchaseRequestItemInsertInput[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const resolvedItems = await resolvePurchaseRequestItemBrands(db, items);
  const requestNumber = await generatePurchaseRequestNumber(data.projectId);
  const project = await getProjectById(data.projectId);
  const printedDocumentContent = buildPurchaseRequestDocument({
    requestNumber,
    projectLabel: project
      ? `${project.code} - ${project.name}`
      : `Proyecto ${data.projectId}`,
    purchaseType: getPurchaseTypeLabel(data.purchaseType),
    neededBy: data.neededBy,
    printedAt: new Date(),
    items: resolvedItems.map(item => ({
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
    })),
  });

  const [created] = await db
    .insert(purchaseRequests)
    .values({
      ...data,
      requestNumber,
      printedDocumentName: `${requestNumber}.pdf`,
      printedDocumentMimeType: "application/pdf",
      printedDocumentContent,
      printedAt: new Date(),
    })
    .returning({ id: purchaseRequests.id });

  if (resolvedItems.length > 0) {
    await db.insert(purchaseRequestItems).values(
      resolvedItems.map(item => ({
        ...item,
        purchaseRequestId: created.id,
      }))
    );
  }

  return { id: created.id, requestNumber };
}

export async function listPurchaseRequests(filters?: {
  projectId?: number;
  projectIds?: number[];
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const purchaseRequestCreatedByUsers = alias(
    users,
    "purchase_request_created_by_users"
  );
  const materialRequestRequestedByUsers = alias(
    users,
    "purchase_request_material_request_requested_by_users"
  );
  const conditions = [];
  if (filters?.projectId)
    conditions.push(eq(purchaseRequests.projectId, filters.projectId));
  if (filters?.projectIds) {
    applyProjectScope(
      conditions,
      purchaseRequests.projectId,
      filters.projectIds
    );
  }
  if (filters?.status)
    conditions.push(eq(purchaseRequests.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      purchaseRequest: purchaseRequests,
      project: projects,
      materialRequest: materialRequests,
      requestedBy: materialRequestRequestedByUsers,
      createdBy: purchaseRequestCreatedByUsers,
    })
    .from(purchaseRequests)
    .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(purchaseRequests.materialRequestId, materialRequests.id)
    )
    .leftJoin(
      materialRequestRequestedByUsers,
      eq(materialRequests.requestedById, materialRequestRequestedByUsers.id)
    )
    .leftJoin(
      purchaseRequestCreatedByUsers,
      eq(purchaseRequests.createdById, purchaseRequestCreatedByUsers.id)
    )
    .where(where)
    .orderBy(desc(purchaseRequests.createdAt));

  const purchaseRequestIds = rows
    .map(row => row.purchaseRequest.id)
    .filter((value): value is number => typeof value === "number");

  if (purchaseRequestIds.length === 0) {
    return rows;
  }

  const sourceRows = await db
    .select({
      purchaseRequestId: purchaseRequestItems.purchaseRequestId,
      requestedQuantity: purchaseRequestItems.quantity,
      convertedQuantity: purchaseRequestItems.convertedQuantity,
      requestId: materialRequests.id,
      requestNumber: materialRequests.requestNumber,
      requestedById: materialRequests.requestedById,
      requestApprovedById: materialRequests.approvedById,
      itemApprovedById: requestItems.approvedById,
      projectId: materialRequests.projectId,
      projectCode: projects.code,
      projectName: projects.name,
    })
    .from(purchaseRequestItems)
    .leftJoin(
      requestItems,
      eq(purchaseRequestItems.materialRequestItemId, requestItems.id)
    )
    .leftJoin(materialRequests, eq(requestItems.requestId, materialRequests.id))
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(inArray(purchaseRequestItems.purchaseRequestId, purchaseRequestIds));

  const sourceProjectsByPurchaseRequestId = new Map<
    number,
    Array<{ id: number; code: string | null; name: string | null }>
  >();
  const requestNumbersByPurchaseRequestId = new Map<number, string[]>();
  const requestedByIdsByPurchaseRequestId = new Map<number, number[]>();
  const approvedByIdsByPurchaseRequestId = new Map<number, number[]>();
  const pendingConversionByPurchaseRequestId = new Map<
    number,
    { itemCount: number; quantity: number }
  >();
  const addUserId = (
    map: Map<number, number[]>,
    purchaseRequestId: number,
    userId: number | null | undefined,
    prepend = false
  ) => {
    if (typeof userId !== "number") return;
    const current = map.get(purchaseRequestId) ?? [];
    if (!current.includes(userId)) {
      if (prepend) current.unshift(userId);
      else current.push(userId);
    }
    map.set(purchaseRequestId, current);
  };

  for (const row of sourceRows) {
    if (!row.purchaseRequestId) continue;

    if (row.requestNumber) {
      const current =
        requestNumbersByPurchaseRequestId.get(row.purchaseRequestId) ?? [];
      if (!current.includes(row.requestNumber)) {
        current.push(row.requestNumber);
      }
      requestNumbersByPurchaseRequestId.set(row.purchaseRequestId, current);
    }

    if (row.requestedById) {
      const current =
        requestedByIdsByPurchaseRequestId.get(row.purchaseRequestId) ?? [];
      if (!current.includes(row.requestedById)) {
        current.push(row.requestedById);
      }
      requestedByIdsByPurchaseRequestId.set(row.purchaseRequestId, current);
    }
    addUserId(
      approvedByIdsByPurchaseRequestId,
      row.purchaseRequestId,
      row.itemApprovedById
    );
    addUserId(
      approvedByIdsByPurchaseRequestId,
      row.purchaseRequestId,
      row.requestApprovedById
    );

    const pendingConversionQuantity = getPendingConversionQuantity({
      quantity: row.requestedQuantity,
      convertedQuantity: row.convertedQuantity,
    });
    const pendingSummary = pendingConversionByPurchaseRequestId.get(
      row.purchaseRequestId
    ) ?? {
      itemCount: 0,
      quantity: 0,
    };
    if (pendingConversionQuantity > 0) {
      pendingSummary.itemCount += 1;
      pendingSummary.quantity += pendingConversionQuantity;
    }
    pendingConversionByPurchaseRequestId.set(
      row.purchaseRequestId,
      pendingSummary
    );

    if (row.projectId) {
      const current =
        sourceProjectsByPurchaseRequestId.get(row.purchaseRequestId) ?? [];
      if (!current.some(entry => entry.id === row.projectId)) {
        current.push({
          id: row.projectId,
          code: row.projectCode ?? null,
          name: row.projectName ?? null,
        });
      }
      sourceProjectsByPurchaseRequestId.set(row.purchaseRequestId, current);
    }
  }

  for (const row of rows) {
    if (row.materialRequest?.requestNumber) {
      const current =
        requestNumbersByPurchaseRequestId.get(row.purchaseRequest.id) ?? [];
      if (!current.includes(row.materialRequest.requestNumber)) {
        current.unshift(row.materialRequest.requestNumber);
      }
      requestNumbersByPurchaseRequestId.set(row.purchaseRequest.id, current);
    }
    if (row.materialRequest?.requestedById) {
      const current =
        requestedByIdsByPurchaseRequestId.get(row.purchaseRequest.id) ?? [];
      if (!current.includes(row.materialRequest.requestedById)) {
        current.unshift(row.materialRequest.requestedById);
      }
      requestedByIdsByPurchaseRequestId.set(row.purchaseRequest.id, current);
    }
    addUserId(
      approvedByIdsByPurchaseRequestId,
      row.purchaseRequest.id,
      row.materialRequest?.approvedById,
      true
    );
  }

  const requestedByUserIds = Array.from(
    new Set(
      Array.from(requestedByIdsByPurchaseRequestId.values())
        .flat()
        .filter((value): value is number => typeof value === "number")
    )
  );
  const requestedByUsers =
    requestedByUserIds.length > 0
      ? await db
          .select()
          .from(users)
          .where(inArray(users.id, requestedByUserIds))
      : [];
  const requestedByUsersById = new Map(
    requestedByUsers.map(user => [user.id, user])
  );
  const approvedByUserIds = Array.from(
    new Set(
      Array.from(approvedByIdsByPurchaseRequestId.values())
        .flat()
        .filter((value): value is number => typeof value === "number")
    )
  );
  const approverUsers =
    approvedByUserIds.length > 0
      ? await db
          .select()
          .from(users)
          .where(inArray(users.id, approvedByUserIds))
      : [];
  const approvedByUsersById = new Map(
    approverUsers.map(user => [user.id, user])
  );

  return rows.map(row => {
    const sourceProjects =
      sourceProjectsByPurchaseRequestId.get(row.purchaseRequest.id) ?? [];
    const projectSummary =
      sourceProjects.length > 1
        ? {
            isMixed: true,
            label: "Varios proyectos",
          }
        : sourceProjects.length === 1
          ? {
              isMixed: false,
              label:
                `${sourceProjects[0].code ?? ""} — ${sourceProjects[0].name ?? ""}`
                  .replace(/^ — /, "")
                  .trim(),
            }
          : null;
    const requestedByIds =
      requestedByIdsByPurchaseRequestId.get(row.purchaseRequest.id) ?? [];
    const requestedByUsers = requestedByIds
      .map(id => requestedByUsersById.get(id))
      .filter((user): user is User => Boolean(user));
    const approvedByIds =
      approvedByIdsByPurchaseRequestId.get(row.purchaseRequest.id) ?? [];
    const approvedByUsers = approvedByIds
      .map(id => approvedByUsersById.get(id))
      .filter((user): user is User => Boolean(user));

    return {
      ...row,
      requestNumbers:
        requestNumbersByPurchaseRequestId.get(row.purchaseRequest.id) ?? [],
      requestedBy: row.requestedBy ?? requestedByUsers[0] ?? null,
      requestedByUsers,
      approvedBy: approvedByUsers[0] ?? null,
      approvedByUsers,
      createdBy: row.createdBy,
      projectSummary,
      sourceProjects,
      pendingConversionItemCount:
        pendingConversionByPurchaseRequestId.get(row.purchaseRequest.id)
          ?.itemCount ?? 0,
      pendingConversionQuantity: toDecimalString(
        pendingConversionByPurchaseRequestId.get(row.purchaseRequest.id)
          ?.quantity ?? 0
      ),
    };
  });
}

export async function getPurchaseRequestById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      purchaseRequest: purchaseRequests,
      project: projects,
      materialRequest: materialRequests,
      warehouse: warehouses,
    })
    .from(purchaseRequests)
    .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(purchaseRequests.materialRequestId, materialRequests.id)
    )
    .leftJoin(warehouses, eq(projects.warehouseId, warehouses.id))
    .where(eq(purchaseRequests.id, id))
    .limit(1);

  if (!rows[0]) return undefined;
  const purchaseRequestItemSubprojects = alias(
    projectSubprojects,
    "purchase_request_item_subprojects"
  );
  const sourceItemSubprojects = alias(
    projectSubprojects,
    "source_item_subprojects"
  );
  const itemRows = await db
    .select({
      item: purchaseRequestItems,
      sourceItem: requestItems,
      sourceRequest: materialRequests,
      sourceProject: projects,
      itemSubproject: purchaseRequestItemSubprojects,
      sourceSubproject: sourceItemSubprojects,
    })
    .from(purchaseRequestItems)
    .leftJoin(
      requestItems,
      eq(purchaseRequestItems.materialRequestItemId, requestItems.id)
    )
    .leftJoin(materialRequests, eq(requestItems.requestId, materialRequests.id))
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .leftJoin(
      purchaseRequestItemSubprojects,
      eq(purchaseRequestItems.subProjectId, purchaseRequestItemSubprojects.id)
    )
    .leftJoin(
      sourceItemSubprojects,
      eq(requestItems.subProjectId, sourceItemSubprojects.id)
    )
    .where(eq(purchaseRequestItems.purchaseRequestId, id));

  const itemCatalogCodes = Array.from(
    new Set(
      itemRows.flatMap(row =>
        [
          row.item.currentSapItemCode,
          row.item.originalSapItemCode,
          row.sourceItem?.sapItemCode,
        ]
          .map(normalizeOptionalText)
          .filter((value): value is string => Boolean(value))
      )
    )
  );
  const itemCatalogRows =
    itemCatalogCodes.length > 0
      ? await db
          .select({
            id: sapCatalog.id,
            itemCode: sapCatalog.itemCode,
            description: sapCatalog.description,
            itemGroup: sapCatalog.itemGroup,
            brand: sapCatalog.brand,
            partNumber: sapCatalog.partNumber,
            tipoArticulo: sapCatalog.tipoArticulo,
          })
          .from(sapCatalog)
          .where(inArray(sapCatalog.itemCode, itemCatalogCodes))
      : [];
  const catalogByItemCode = new Map(
    itemCatalogRows.map(catalog => [catalog.itemCode, catalog] as const)
  );

  const userIds = Array.from(
    new Set(
      [
        rows[0].materialRequest?.requestedById,
        rows[0].purchaseRequest.createdById,
        ...itemRows.map(row => row.sourceRequest?.requestedById),
      ].filter((value): value is number => typeof value === "number")
    )
  );
  const userRows =
    userIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, userIds))
      : [];
  const usersById = new Map(userRows.map(user => [user.id, user]));

  const items = itemRows.map(row => {
    const catalog =
      catalogByItemCode.get(row.item.currentSapItemCode?.trim() ?? "") ??
      catalogByItemCode.get(row.item.originalSapItemCode?.trim() ?? "") ??
      catalogByItemCode.get(row.sourceItem?.sapItemCode?.trim() ?? "") ??
      null;
    const savedBrand = normalizeOptionalText(row.item.brand);

    return {
      ...row.item,
      brand: savedBrand ?? normalizeOptionalText(catalog?.brand),
      catalogItem: catalog,
      requestedItemName: normalizeOptionalText(row.sourceItem?.itemName),
      pendingConversionQuantity: toDecimalString(
        getPendingConversionQuantity(row.item)
      ),
      sourceRequest: row.sourceRequest,
      sourceProject: row.sourceProject,
      target:
        mapMaterialRequestTarget(row.item, row.itemSubproject) ??
        (row.sourceItem
          ? mapMaterialRequestTarget(row.sourceItem, row.sourceSubproject)
          : null),
      sourceTarget: row.sourceItem
        ? mapMaterialRequestTarget(row.sourceItem, row.sourceSubproject)
        : null,
    };
  });

  const sourceProjects = itemRows.reduce<
    Array<{ id: number; code: string | null; name: string | null }>
  >((acc, row) => {
    if (!row.sourceProject?.id) return acc;
    if (acc.some(entry => entry.id === row.sourceProject?.id)) return acc;
    acc.push({
      id: row.sourceProject.id,
      code: row.sourceProject.code ?? null,
      name: row.sourceProject.name ?? null,
    });
    return acc;
  }, []);

  const projectSummary =
    sourceProjects.length > 1
      ? {
          isMixed: true,
          label: "Varios proyectos",
        }
      : sourceProjects.length === 1
        ? {
            isMixed: false,
            label:
              `${sourceProjects[0].code ?? ""} — ${sourceProjects[0].name ?? ""}`
                .replace(/^ — /, "")
                .trim(),
          }
        : null;
  const sourceRequestedById = itemRows.find(
    row => row.sourceRequest?.requestedById
  )?.sourceRequest?.requestedById;

  const printedDocumentContent = buildPurchaseRequestDocument({
    requestNumber: rows[0].purchaseRequest.requestNumber,
    projectLabel: rows[0].project
      ? `${rows[0].project.code} - ${rows[0].project.name}`
      : `Proyecto ${rows[0].purchaseRequest.projectId}`,
    purchaseType: getPurchaseTypeLabel(rows[0].purchaseRequest.purchaseType),
    neededBy: rows[0].purchaseRequest.neededBy,
    printedAt: rows[0].purchaseRequest.printedAt,
    items: items.map(item => ({
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
    })),
  });

  return {
    ...rows[0],
    purchaseRequest: {
      ...rows[0].purchaseRequest,
      printedDocumentContent,
      printedDocumentMimeType:
        rows[0].purchaseRequest.printedDocumentMimeType ?? "application/pdf",
      printedDocumentName:
        rows[0].purchaseRequest.printedDocumentName ??
        `${rows[0].purchaseRequest.requestNumber}.pdf`,
    },
    projectSummary,
    sourceProjects,
    requestedBy: rows[0].materialRequest?.requestedById
      ? (usersById.get(rows[0].materialRequest.requestedById) ?? null)
      : sourceRequestedById
        ? (usersById.get(sourceRequestedById) ?? null)
        : null,
    createdBy: usersById.get(rows[0].purchaseRequest.createdById) ?? null,
    items,
  };
}

export async function getActivePurchaseRequestByMaterialRequestItemId(
  materialRequestItemId: number
) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      purchaseRequest: purchaseRequests,
      purchaseRequestItem: purchaseRequestItems,
    })
    .from(purchaseRequestItems)
    .innerJoin(
      purchaseRequests,
      eq(purchaseRequestItems.purchaseRequestId, purchaseRequests.id)
    )
    .where(
      and(
        eq(purchaseRequestItems.materialRequestItemId, materialRequestItemId),
        sql`${purchaseRequests.status} NOT IN ('rechazada', 'anulada')`
      )
    )
    .orderBy(desc(purchaseRequests.createdAt))
    .limit(1);

  return rows[0];
}

export async function updatePurchaseRequest(
  id: number,
  data: Partial<InsertPurchaseRequest>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(purchaseRequests)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(purchaseRequests.id, id));
  return { success: true };
}

export async function updatePurchaseRequestItem(
  id: number,
  data: Partial<InsertPurchaseRequestItem>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(purchaseRequestItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(purchaseRequestItems.id, id));
  return { success: true };
}

export async function getPurchaseRequestItemById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.id, id))
    .limit(1);

  return rows[0];
}

export async function adjustPurchaseRequestItemConvertedQuantity(
  id: number,
  delta: string | number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.id, id))
    .limit(1);
  if (!item) {
    throw new Error("Ítem de solicitud de compra no encontrado");
  }

  const nextConvertedQuantity = Math.max(
    parseDecimal(item.convertedQuantity) + parseDecimal(delta),
    0
  );
  await updatePurchaseRequestItem(id, {
    convertedQuantity: toDecimalString(nextConvertedQuantity),
  });

  return {
    ...item,
    convertedQuantity: toDecimalString(nextConvertedQuantity),
  };
}

export async function syncPurchaseRequestConversionStatus(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [purchaseRequest] = await db
    .select()
    .from(purchaseRequests)
    .where(eq(purchaseRequests.id, id))
    .limit(1);
  if (!purchaseRequest) {
    throw new Error("Solicitud de compra no encontrada");
  }
  if (["rechazada", "anulada"].includes(purchaseRequest.status)) {
    return purchaseRequest.status;
  }

  const items = await db
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.purchaseRequestId, id));

  if (items.length === 0) {
    return purchaseRequest.status;
  }

  const allConverted = items.every(
    item => getPendingConversionQuantity(item) <= 0
  );
  const hasConverted = items.some(
    item => parseDecimal(item.convertedQuantity) > 0
  );
  const nextStatus = allConverted
    ? "convertida"
    : hasConverted
      ? "parcialmente_convertida"
      : ["convertida", "parcialmente_convertida"].includes(
            purchaseRequest.status
          )
        ? "pendiente"
        : purchaseRequest.status;

  if (nextStatus !== purchaseRequest.status) {
    await updatePurchaseRequest(id, { status: nextStatus as any });
  }

  return nextStatus;
}

export async function addPurchaseRequestItems(
  purchaseRequestId: number,
  items: PurchaseRequestItemInsertInput[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const resolvedItems = await resolvePurchaseRequestItemBrands(db, items);

  if (resolvedItems.length > 0) {
    await db.insert(purchaseRequestItems).values(
      resolvedItems.map(item => ({
        ...item,
        purchaseRequestId,
      }))
    );
  }

  await db
    .update(purchaseRequests)
    .set({ updatedAt: new Date() })
    .where(eq(purchaseRequests.id, purchaseRequestId));

  return { success: true };
}

export async function getReusablePurchaseRequestBySourcePurchaseOrderId(
  sourcePurchaseOrderId: number
) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select()
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.sourcePurchaseOrderId, sourcePurchaseOrderId),
        sql`${purchaseRequests.status} NOT IN ('rechazada', 'anulada', 'convertida')`
      )
    )
    .orderBy(desc(purchaseRequests.createdAt))
    .limit(1);

  return rows[0];
}

export async function rejectPurchaseRequest(
  id: number,
  rejectionReason: string
) {
  return updatePurchaseRequest(id, {
    status: "rechazada",
    rejectionReason,
  });
}

export async function cancelPurchaseRequest(
  id: number,
  cancellationReason: string
) {
  return updatePurchaseRequest(id, {
    status: "anulada",
    rejectionReason: cancellationReason,
  });
}

export async function createPurchaseOrder(
  data: Omit<InsertPurchaseOrder, "orderNumber">,
  items: Omit<InsertPurchaseOrderItem, "purchaseOrderId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const orderNumber = await generatePurchaseOrderNumber(
    data.projectId,
    data.classification ?? "oc"
  );
  const project = await getProjectById(data.projectId);
  const supplier = data.supplierId
    ? await getSupplierById(data.supplierId)
    : null;
  const selectedSupplierContact = data.supplierContactId
    ? await getSupplierContactById(data.supplierContactId)
    : null;
  const preferredSupplierContact =
    selectedSupplierContact ??
    (await getPreferredSupplierSalesContact({
      supplierId: data.supplierId,
      projectId: data.projectId,
    }));
  const [sourcePurchaseRequest] = data.purchaseRequestId
    ? await db
        .select()
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, data.purchaseRequestId))
        .limit(1)
    : [null];
  const [createdBy] = await db
    .select()
    .from(users)
    .where(eq(users.id, data.createdById))
    .limit(1);
  const normalizedItems = await Promise.all(
    items.map(async item => ({
      ...item,
      ...(await preparePurchaseOrderTaxDataForLine({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxCode: item.taxCode,
        additionalTaxCodes: item.additionalTaxCodes as any,
      })),
    }))
  );
  const purchaseRequestItemTargetSubprojects = alias(
    projectSubprojects,
    "create_po_purchase_request_item_subprojects"
  );
  const sourceItemTargetSubprojects = alias(
    projectSubprojects,
    "create_po_source_item_subprojects"
  );
  const purchaseRequestItemIds = Array.from(
    new Set(
      normalizedItems
        .map(item => item.purchaseRequestItemId)
        .filter((value): value is number => typeof value === "number")
    )
  );
  const materialRequestItemIds = Array.from(
    new Set(
      normalizedItems
        .map(item => item.materialRequestItemId)
        .filter((value): value is number => typeof value === "number")
    )
  );
  const purchaseRequestTargetRows =
    purchaseRequestItemIds.length > 0
      ? await db
          .select({
            item: purchaseRequestItems,
            subproject: purchaseRequestItemTargetSubprojects,
          })
          .from(purchaseRequestItems)
          .leftJoin(
            purchaseRequestItemTargetSubprojects,
            eq(
              purchaseRequestItems.subProjectId,
              purchaseRequestItemTargetSubprojects.id
            )
          )
          .where(inArray(purchaseRequestItems.id, purchaseRequestItemIds))
      : [];
  const sourceTargetRows =
    materialRequestItemIds.length > 0
      ? await db
          .select({
            item: requestItems,
            subproject: sourceItemTargetSubprojects,
          })
          .from(requestItems)
          .leftJoin(
            sourceItemTargetSubprojects,
            eq(requestItems.subProjectId, sourceItemTargetSubprojects.id)
          )
          .where(inArray(requestItems.id, materialRequestItemIds))
      : [];
  const targetLabelByPurchaseRequestItemId = new Map(
    purchaseRequestTargetRows.map(row => {
      const target = mapMaterialRequestTarget(row.item, row.subproject);
      return [
        row.item.id,
        target ? buildPurchaseOrderItemDestinationLabel({ target }) : "-",
      ] as const;
    })
  );
  const targetLabelByMaterialRequestItemId = new Map(
    sourceTargetRows.map(row => {
      const target = mapMaterialRequestTarget(row.item, row.subproject);
      return [
        row.item.id,
        target ? buildPurchaseOrderItemDestinationLabel({ target }) : "-",
      ] as const;
    })
  );
  const printedAt = new Date();
  const projectLabel = project
    ? `${project.code ?? ""} ${project.name ?? ""}`.trim()
    : `Proyecto ${data.projectId}`;
  const printedDocumentContent = buildPurchaseOrderDocument({
    orderNumber,
    orderId: orderNumber,
    classification: data.classification ?? "oc",
    status: data.status ?? "emitida",
    projectLabel,
    supplierLabel: supplier?.name ?? "Proveedor pendiente",
    createdAt: printedAt,
    neededBy: data.neededBy,
    printedAt,
    requestedByLabel: createdBy?.name ?? "-",
    salesAdvisorLabel: formatSupplierContactReference(preferredSupplierContact),
    observations: data.notes,
    quoteLabel: sourcePurchaseRequest?.quoteAttachmentId
      ? String(sourcePurchaseRequest.quoteAttachmentId)
      : "-",
    items: normalizedItems.map(item => ({
      itemName: item.itemName,
      currentSapItemCode: item.currentSapItemCode,
      originalSapItemCode: item.originalSapItemCode,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
      additionalTaxCodes: item.additionalTaxCodes,
      taxBreakdown: item.taxBreakdown,
      targetLabel:
        (item.purchaseRequestItemId
          ? targetLabelByPurchaseRequestItemId.get(item.purchaseRequestItemId)
          : null) ||
        (item.materialRequestItemId
          ? targetLabelByMaterialRequestItemId.get(item.materialRequestItemId)
          : null) ||
        null,
    })),
  });

  const [created] = await db
    .insert(purchaseOrders)
    .values({
      ...data,
      orderNumber,
      ...buildSupplierContactSnapshot(preferredSupplierContact),
      printedDocumentName: `${orderNumber}.pdf`,
      printedDocumentMimeType: "application/pdf",
      printedDocumentContent,
      printedAt,
      supplierEmail: data.supplierEmail ?? supplier?.email ?? null,
      status: data.status ?? "emitida",
    })
    .returning({ id: purchaseOrders.id });

  if (normalizedItems.length > 0) {
    await db.insert(purchaseOrderItems).values(
      normalizedItems.map(item => ({
        ...item,
        purchaseOrderId: created.id,
      }))
    );
  }

  return { id: created.id, orderNumber };
}

async function getPurchaseOrderInvoiceCountMap(orderIds: number[]) {
  const db = await getDb();
  if (!db || orderIds.length === 0) return new Map<number, number>();

  const rows = await db
    .select({
      purchaseOrderId: invoices.purchaseOrderId,
      count: count(),
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.purchaseOrderId, orderIds),
        sql`${invoices.status} <> 'anulada'`
      )
    )
    .groupBy(invoices.purchaseOrderId);

  return new Map(rows.map(row => [row.purchaseOrderId, Number(row.count)]));
}

function buildPurchaseOrderContractSummary(
  purchaseOrder: typeof purchaseOrders.$inferSelect,
  registeredInvoiceCount: number
) {
  return getPurchaseOrderContractSummary({
    appliesContract: purchaseOrder.appliesContract,
    contractPaymentFrequency: purchaseOrder.contractPaymentFrequency,
    contractFirstPaymentDate: purchaseOrder.contractFirstPaymentDate,
    contractEndDate: purchaseOrder.contractEndDate,
    registeredInvoiceCount,
  });
}

export async function listPurchaseOrders(filters?: {
  projectId?: number;
  projectIds?: number[];
  classification?: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const purchaseOrderCreatedByUsers = alias(users, "po_list_created_by_users");
  const purchaseOrderMaterialRequests = alias(
    materialRequests,
    "po_list_material_requests"
  );
  const conditions = [];
  if (filters?.projectId)
    conditions.push(eq(purchaseOrders.projectId, filters.projectId));
  if (filters?.projectIds) {
    applyProjectScope(conditions, purchaseOrders.projectId, filters.projectIds);
  }
  if (filters?.classification) {
    conditions.push(
      eq(purchaseOrders.classification, filters.classification as any)
    );
  }
  if (filters?.status)
    conditions.push(eq(purchaseOrders.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      purchaseOrder: purchaseOrders,
      purchaseRequest: purchaseRequests,
      materialRequest: purchaseOrderMaterialRequests,
      project: projects,
      supplier: suppliers,
      createdBy: purchaseOrderCreatedByUsers,
    })
    .from(purchaseOrders)
    .leftJoin(
      purchaseRequests,
      eq(purchaseOrders.purchaseRequestId, purchaseRequests.id)
    )
    .leftJoin(
      purchaseOrderMaterialRequests,
      eq(purchaseRequests.materialRequestId, purchaseOrderMaterialRequests.id)
    )
    .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(
      purchaseOrderCreatedByUsers,
      eq(purchaseOrders.createdById, purchaseOrderCreatedByUsers.id)
    )
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt));

  const purchaseOrderIds = rows
    .map(row => row.purchaseOrder.id)
    .filter((value): value is number => typeof value === "number");
  const requestNumbersByOrderId = new Map<number, string[]>();
  const requestedByIdsByOrderId = new Map<number, number[]>();
  const addRequestNumber = (
    purchaseOrderId: number,
    requestNumber: string | null | undefined,
    prepend = false
  ) => {
    const normalized = requestNumber?.trim();
    if (!normalized) return;
    const current = requestNumbersByOrderId.get(purchaseOrderId) ?? [];
    if (!current.includes(normalized)) {
      if (prepend) current.unshift(normalized);
      else current.push(normalized);
    }
    requestNumbersByOrderId.set(purchaseOrderId, current);
  };
  const addRequestedById = (
    purchaseOrderId: number,
    userId: number | null | undefined,
    prepend = false
  ) => {
    if (typeof userId !== "number") return;
    const current = requestedByIdsByOrderId.get(purchaseOrderId) ?? [];
    if (!current.includes(userId)) {
      if (prepend) current.unshift(userId);
      else current.push(userId);
    }
    requestedByIdsByOrderId.set(purchaseOrderId, current);
  };

  if (purchaseOrderIds.length > 0) {
    const purchaseRequestSourceItems = alias(
      requestItems,
      "po_list_purchase_request_source_items"
    );
    const purchaseRequestSourceRequests = alias(
      materialRequests,
      "po_list_purchase_request_source_requests"
    );
    const directSourceItems = alias(
      requestItems,
      "po_list_direct_source_items"
    );
    const directSourceRequests = alias(
      materialRequests,
      "po_list_direct_source_requests"
    );
    const sourceRows = await db
      .select({
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        purchaseRequestRequestNumber:
          purchaseRequestSourceRequests.requestNumber,
        purchaseRequestRequestedById:
          purchaseRequestSourceRequests.requestedById,
        directRequestNumber: directSourceRequests.requestNumber,
        directRequestedById: directSourceRequests.requestedById,
      })
      .from(purchaseOrderItems)
      .leftJoin(
        purchaseRequestItems,
        eq(purchaseOrderItems.purchaseRequestItemId, purchaseRequestItems.id)
      )
      .leftJoin(
        purchaseRequestSourceItems,
        eq(
          purchaseRequestItems.materialRequestItemId,
          purchaseRequestSourceItems.id
        )
      )
      .leftJoin(
        purchaseRequestSourceRequests,
        eq(
          purchaseRequestSourceItems.requestId,
          purchaseRequestSourceRequests.id
        )
      )
      .leftJoin(
        directSourceItems,
        eq(purchaseOrderItems.materialRequestItemId, directSourceItems.id)
      )
      .leftJoin(
        directSourceRequests,
        eq(directSourceItems.requestId, directSourceRequests.id)
      )
      .where(inArray(purchaseOrderItems.purchaseOrderId, purchaseOrderIds));

    for (const row of sourceRows) {
      if (!row.purchaseOrderId) continue;
      addRequestNumber(row.purchaseOrderId, row.purchaseRequestRequestNumber);
      addRequestNumber(row.purchaseOrderId, row.directRequestNumber);
      addRequestedById(row.purchaseOrderId, row.purchaseRequestRequestedById);
      addRequestedById(row.purchaseOrderId, row.directRequestedById);
    }
  }

  for (const row of rows) {
    addRequestNumber(
      row.purchaseOrder.id,
      row.materialRequest?.requestNumber,
      true
    );
    addRequestedById(
      row.purchaseOrder.id,
      row.materialRequest?.requestedById,
      true
    );
    if (!requestedByIdsByOrderId.has(row.purchaseOrder.id)) {
      addRequestedById(row.purchaseOrder.id, row.purchaseRequest?.createdById);
    }
  }

  const requestedByUserIds = Array.from(
    new Set(
      Array.from(requestedByIdsByOrderId.values())
        .flat()
        .filter((value): value is number => typeof value === "number")
    )
  );
  const requestedByUsers =
    requestedByUserIds.length > 0
      ? await db
          .select()
          .from(users)
          .where(inArray(users.id, requestedByUserIds))
      : [];
  const requestedByUsersById = new Map(
    requestedByUsers.map(user => [user.id, user])
  );
  const invoiceCountMap =
    await getPurchaseOrderInvoiceCountMap(purchaseOrderIds);

  return rows.map(row => {
    const requestedByIds =
      requestedByIdsByOrderId.get(row.purchaseOrder.id) ?? [];
    const requestedByUsers = requestedByIds
      .map(id => requestedByUsersById.get(id))
      .filter((user): user is User => Boolean(user));

    return {
      ...row,
      originalRequestNumbers:
        requestNumbersByOrderId.get(row.purchaseOrder.id) ?? [],
      originalRequester: requestedByUsers[0] ?? null,
      requestedByUsers,
      contractSummary: buildPurchaseOrderContractSummary(
        row.purchaseOrder,
        invoiceCountMap.get(row.purchaseOrder.id) ?? 0
      ),
    };
  });
}

export async function getPurchaseOrderById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      purchaseOrder: purchaseOrders,
      purchaseRequest: purchaseRequests,
      project: projects,
      supplier: suppliers,
      createdBy: users,
    })
    .from(purchaseOrders)
    .leftJoin(
      purchaseRequests,
      eq(purchaseOrders.purchaseRequestId, purchaseRequests.id)
    )
    .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(users, eq(purchaseOrders.createdById, users.id))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!rows[0]) return undefined;
  const purchaseRequestItemSubprojects = alias(
    projectSubprojects,
    "po_purchase_request_item_subprojects"
  );
  const sourceItemSubprojects = alias(
    projectSubprojects,
    "po_source_item_subprojects"
  );
  const itemRows = await db
    .select({
      item: purchaseOrderItems,
      purchaseRequestItem: purchaseRequestItems,
      sourceItem: requestItems,
      purchaseRequestItemSubproject: purchaseRequestItemSubprojects,
      sourceItemSubproject: sourceItemSubprojects,
    })
    .from(purchaseOrderItems)
    .leftJoin(
      purchaseRequestItems,
      eq(purchaseOrderItems.purchaseRequestItemId, purchaseRequestItems.id)
    )
    .leftJoin(
      requestItems,
      or(
        eq(purchaseOrderItems.materialRequestItemId, requestItems.id),
        eq(purchaseRequestItems.materialRequestItemId, requestItems.id)
      )
    )
    .leftJoin(
      purchaseRequestItemSubprojects,
      eq(purchaseRequestItems.subProjectId, purchaseRequestItemSubprojects.id)
    )
    .leftJoin(
      sourceItemSubprojects,
      eq(requestItems.subProjectId, sourceItemSubprojects.id)
    )
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderItems.id));
  const itemCatalogCodes = Array.from(
    new Set(
      itemRows
        .flatMap(row => [
          row.item.currentSapItemCode,
          row.item.originalSapItemCode,
        ])
        .map(code => code?.trim())
        .filter((code): code is string => Boolean(code))
    )
  );
  const itemCatalogRows =
    itemCatalogCodes.length > 0
      ? await db
          .select({
            id: sapCatalog.id,
            itemCode: sapCatalog.itemCode,
            description: sapCatalog.description,
            itemGroup: sapCatalog.itemGroup,
            brand: sapCatalog.brand,
            partNumber: sapCatalog.partNumber,
            tipoArticulo: sapCatalog.tipoArticulo,
          })
          .from(sapCatalog)
          .where(inArray(sapCatalog.itemCode, itemCatalogCodes))
      : [];
  const catalogByItemCode = new Map(
    itemCatalogRows.map(catalog => [catalog.itemCode, catalog] as const)
  );
  const itemIds = itemRows.map(row => row.item.id);
  const fixedAssetArticleIds = itemRows
    .map(row => row.item.fixedAssetArticleId)
    .filter((value): value is number => typeof value === "number");
  const fixedAssetArticleRows =
    itemIds.length > 0 || fixedAssetArticleIds.length > 0
      ? await db
          .select()
          .from(sapCatalog)
          .where(
            and(
              eq(sapCatalog.isActive, true),
              or(
                itemIds.length > 0
                  ? inArray(
                      sapCatalog.fixedAssetSourcePurchaseOrderItemId,
                      itemIds
                    )
                  : undefined,
                fixedAssetArticleIds.length > 0
                  ? inArray(sapCatalog.id, fixedAssetArticleIds)
                  : undefined
              )
            )
          )
          .orderBy(
            asc(sapCatalog.fixedAssetSourcePurchaseOrderItemId),
            asc(sapCatalog.itemCode)
          )
      : [];
  const itemIdByPrimaryArticleId = new Map(
    itemRows
      .filter(row => typeof row.item.fixedAssetArticleId === "number")
      .map(row => [row.item.fixedAssetArticleId as number, row.item.id])
  );
  const fixedAssetArticlesByItemId = fixedAssetArticleRows.reduce(
    (map, article) => {
      const itemId =
        article.fixedAssetSourcePurchaseOrderItemId ??
        itemIdByPrimaryArticleId.get(article.id);
      if (!itemId) return map;

      const articles = map.get(itemId) ?? [];
      articles.push(article);
      map.set(itemId, articles);
      return map;
    },
    new Map<number, typeof fixedAssetArticleRows>()
  );
  const items = itemRows.map(row => {
    const catalog =
      catalogByItemCode.get(row.item.currentSapItemCode?.trim() ?? "") ??
      catalogByItemCode.get(row.item.originalSapItemCode?.trim() ?? "") ??
      null;
    const fixedAssetArticles =
      fixedAssetArticlesByItemId.get(row.item.id) ?? [];
    const computedFixedAssetStatus =
      fixedAssetArticles.length > 0
        ? fixedAssetArticles.every(
            article => article.fixedAssetStatus === "resuelto"
          )
          ? "resuelto"
          : "pendiente"
        : row.item.fixedAssetStatus;
    const target =
      (row.purchaseRequestItem
        ? mapMaterialRequestTarget(
            row.purchaseRequestItem,
            row.purchaseRequestItemSubproject
          )
        : null) ??
      (row.sourceItem
        ? mapMaterialRequestTarget(row.sourceItem, row.sourceItemSubproject)
        : null);

    return {
      ...row.item,
      fixedAssetArticleId:
        row.item.fixedAssetArticleId ?? fixedAssetArticles[0]?.id ?? null,
      fixedAssetStatus: computedFixedAssetStatus,
      fixedAssetArticles,
      targetType: target?.type ?? null,
      subProjectId: target?.type === "subproyecto" ? target.subProjectId : null,
      fixedAssetSapItemCode:
        target?.type === "activo_fijo" ? target.fixedAssetSapItemCode : null,
      fixedAssetName:
        target?.type === "activo_fijo" ? target.fixedAssetName : null,
      target,
      requestedItemName: normalizeOptionalText(row.sourceItem?.itemName),
      brand: catalog?.brand ?? null,
      partNumber: catalog?.partNumber ?? null,
      catalogItem: catalog,
    };
  });
  const sourceMaterialRequestIds = Array.from(
    new Set(
      [
        rows[0].purchaseRequest?.materialRequestId,
        ...itemRows.map(row => row.sourceItem?.requestId),
      ].filter(
        (value): value is number =>
          typeof value === "number" && Number.isInteger(value)
      )
    )
  );
  const sourceRequestRows =
    sourceMaterialRequestIds.length > 0
      ? await db
          .select({
            request: materialRequests,
            requester: users,
          })
          .from(materialRequests)
          .leftJoin(users, eq(materialRequests.requestedById, users.id))
          .where(inArray(materialRequests.id, sourceMaterialRequestIds))
      : [];
  const purchaseRequestCreatedBy =
    sourceRequestRows.length === 0 && rows[0].purchaseRequest?.createdById
      ? await getUserById(rows[0].purchaseRequest.createdById)
      : null;
  const originalRequester =
    sourceRequestRows.find(row => row.requester?.name || row.requester?.email)
      ?.requester ??
    purchaseRequestCreatedBy ??
    rows[0].createdBy ??
    null;
  const originalRequestNumbers = Array.from(
    new Set(
      sourceRequestRows
        .map(row => row.request.requestNumber)
        .filter((value): value is string => Boolean(value))
    )
  );
  const invoiceCountMap = await getPurchaseOrderInvoiceCountMap([id]);
  const auditLogs = await db
    .select({
      log: purchaseOrderAuditLogs,
      changedBy: users,
    })
    .from(purchaseOrderAuditLogs)
    .leftJoin(users, eq(purchaseOrderAuditLogs.changedById, users.id))
    .where(eq(purchaseOrderAuditLogs.purchaseOrderId, id))
    .orderBy(desc(purchaseOrderAuditLogs.createdAt));
  const projectLabel = rows[0].project
    ? `${rows[0].project.code ?? ""} ${rows[0].project.name ?? ""}`.trim()
    : `Proyecto ${rows[0].purchaseOrder.projectId}`;
  const storedSupplierContact = rows[0].purchaseOrder.supplierContactId
    ? await getSupplierContactById(rows[0].purchaseOrder.supplierContactId)
    : null;
  const fallbackSupplierContact =
    !storedSupplierContact && !rows[0].purchaseOrder.salesAdvisorName
      ? await getPreferredSupplierSalesContact({
          supplierId: rows[0].purchaseOrder.supplierId,
          projectId: rows[0].purchaseOrder.projectId,
        })
      : null;
  const preferredSupplierContact = buildPurchaseOrderSalesAdvisorContact(
    rows[0].purchaseOrder,
    storedSupplierContact ?? fallbackSupplierContact
  );

  const printedDocumentContent = buildPurchaseOrderDocument({
    orderNumber: rows[0].purchaseOrder.orderNumber,
    orderId: rows[0].purchaseOrder.id,
    classification: rows[0].purchaseOrder.classification,
    status: rows[0].purchaseOrder.status,
    projectLabel,
    supplierLabel: rows[0].supplier?.name ?? "Proveedor pendiente",
    createdAt: rows[0].purchaseOrder.createdAt,
    neededBy: rows[0].purchaseOrder.neededBy,
    printedAt: rows[0].purchaseOrder.printedAt,
    requestedByLabel:
      originalRequester?.name ??
      originalRequester?.email ??
      rows[0].createdBy?.name ??
      "-",
    originalRequestLabel:
      originalRequestNumbers.length > 0
        ? originalRequestNumbers.join(", ")
        : "-",
    salesAdvisorLabel: formatSupplierContactReference(preferredSupplierContact),
    observations: rows[0].purchaseOrder.notes,
    quoteLabel: rows[0].purchaseRequest?.quoteAttachmentId
      ? String(rows[0].purchaseRequest.quoteAttachmentId)
      : "-",
    items: items.map(item => ({
      itemName: item.itemName,
      currentSapItemCode: item.currentSapItemCode,
      originalSapItemCode: item.originalSapItemCode,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
      additionalTaxCodes: item.additionalTaxCodes as any,
      taxBreakdown: item.taxBreakdown as any,
      target: item.target,
      targetType: item.targetType,
      subProjectId: item.subProjectId,
      fixedAssetSapItemCode: item.fixedAssetSapItemCode,
      fixedAssetName: item.fixedAssetName,
    })),
  });

  const summary = summarizePurchaseOrderLines(
    items.map(item => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
      additionalTaxCodes: item.additionalTaxCodes as any,
      taxBreakdown: item.taxBreakdown as any,
    }))
  );

  return {
    ...rows[0],
    purchaseOrder: {
      ...rows[0].purchaseOrder,
      printedDocumentContent,
      printedDocumentMimeType:
        rows[0].purchaseOrder.printedDocumentMimeType ?? "application/pdf",
      printedDocumentName:
        rows[0].purchaseOrder.printedDocumentName ??
        `${rows[0].purchaseOrder.orderNumber}.pdf`,
    },
    items,
    summary,
    contractSummary: buildPurchaseOrderContractSummary(
      rows[0].purchaseOrder,
      invoiceCountMap.get(id) ?? 0
    ),
    preferredSupplierContact,
    originalRequester,
    originalRequestNumbers,
    auditLogs,
  };
}

export async function updatePurchaseOrder(
  id: number,
  data: Partial<InsertPurchaseOrder>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const nextData: Partial<InsertPurchaseOrder> = {
    ...data,
    updatedAt: new Date(),
  };

  if (data.supplierId !== undefined) {
    const [current] = await db
      .select({
        projectId: purchaseOrders.projectId,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .limit(1);

    const preferredSupplierContact = await getPreferredSupplierSalesContact({
      supplierId: data.supplierId,
      projectId: current?.projectId,
    });

    Object.assign(
      nextData,
      buildSupplierContactSnapshot(preferredSupplierContact)
    );
  }

  if (data.supplierContactId !== undefined) {
    const selectedSupplierContact = data.supplierContactId
      ? await getSupplierContactById(data.supplierContactId)
      : null;
    Object.assign(
      nextData,
      buildSupplierContactSnapshot(selectedSupplierContact)
    );
  }

  await db
    .update(purchaseOrders)
    .set(nextData)
    .where(eq(purchaseOrders.id, id));
  return { success: true };
}

export async function updatePurchaseOrderItem(
  id: number,
  data: Partial<InsertPurchaseOrderItem>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(purchaseOrderItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(purchaseOrderItems.id, id));
  return { success: true };
}

export async function createPurchaseOrderAuditLog(
  data: InsertPurchaseOrderAuditLog
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [created] = await db
    .insert(purchaseOrderAuditLogs)
    .values(data)
    .returning({ id: purchaseOrderAuditLogs.id });
  return created;
}

export async function updatePurchaseOrderContractTerms(params: {
  purchaseOrderId: number;
  changedById: number;
  appliesContract: boolean;
  contractPaymentFrequency?: InsertPurchaseOrder["contractPaymentFrequency"];
  contractFirstPaymentDate?: Date | null;
  contractEndDate?: Date | null;
  note?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, params.purchaseOrderId))
      .limit(1);
    if (!current) throw new Error("Orden de compra no encontrada");

    const nextData: Partial<InsertPurchaseOrder> = {
      appliesContract: params.appliesContract,
      contractPaymentFrequency: params.appliesContract
        ? (params.contractPaymentFrequency ?? null)
        : null,
      contractFirstPaymentDate: params.appliesContract
        ? (params.contractFirstPaymentDate ?? null)
        : null,
      contractEndDate: params.appliesContract
        ? (params.contractEndDate ?? null)
        : null,
      updatedAt: new Date(),
    };
    if (
      String(current.contractEndDate ?? "") !==
      String(nextData.contractEndDate ?? "")
    ) {
      nextData.contractExpiryNotifiedAt = null;
    }

    await tx
      .update(purchaseOrders)
      .set(nextData)
      .where(eq(purchaseOrders.id, params.purchaseOrderId));

    const auditFields: Array<keyof typeof nextData> = [
      "appliesContract",
      "contractPaymentFrequency",
      "contractFirstPaymentDate",
      "contractEndDate",
    ];
    const logs = auditFields
      .filter(
        field =>
          String((current as any)[field] ?? "") !==
          String((nextData as any)[field] ?? "")
      )
      .map(field => ({
        purchaseOrderId: params.purchaseOrderId,
        purchaseOrderItemId: null,
        action: "actualizar_contrato",
        field,
        oldValue: formatAuditValue((current as any)[field]),
        newValue: formatAuditValue((nextData as any)[field]),
        changedById: params.changedById,
        note: params.note?.trim() || null,
      }));

    if (logs.length > 0) {
      await tx.insert(purchaseOrderAuditLogs).values(logs);
    }

    return { success: true };
  });
}

function formatAuditValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function syncPurchaseOrderReceiptStatus(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [purchaseOrder] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId))
    .limit(1);

  const items = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));

  const invoiceCountMap = await getPurchaseOrderInvoiceCountMap([
    purchaseOrderId,
  ]);
  const nextStatus = purchaseOrder?.appliesContract
    ? invoiceCountMap.get(purchaseOrderId)
      ? ("parcialmente_recibida" as const)
      : ("emitida" as const)
    : getPurchaseOrderReceiptStatus(items);

  await updatePurchaseOrder(purchaseOrderId, {
    status: nextStatus,
  });

  return nextStatus;
}

export async function getPurchaseOrderItemById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      item: purchaseOrderItems,
      purchaseOrder: purchaseOrders,
    })
    .from(purchaseOrderItems)
    .leftJoin(
      purchaseOrders,
      eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)
    )
    .where(eq(purchaseOrderItems.id, id))
    .limit(1);

  return rows[0];
}

export async function countPurchaseOrderItems(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [result] = await db
    .select({ count: count() })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));

  return result?.count ?? 0;
}

export async function deletePurchaseOrderItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, id));
  return { success: true };
}

export async function sendPurchaseOrderEmail(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const detail = await getPurchaseOrderById(id);
  if (!detail) throw new Error("Orden de compra no encontrada");

  const supplierEmail =
    detail.purchaseOrder.supplierEmail ?? detail.supplier?.email ?? null;

  if (!supplierEmail) {
    await updatePurchaseOrder(id, {
      emailStatus: "fallido",
      emailError: "Proveedor sin correo configurado",
    });
    return {
      success: false,
      emailData: buildEmailPreview({
        to: null,
        subject: `Orden de Compra ${detail.purchaseOrder.orderNumber}`,
        lines: [
          "Proveedor sin correo configurado.",
          `Orden: ${detail.purchaseOrder.orderNumber}`,
        ],
      }),
    };
  }

  await updatePurchaseOrder(id, {
    emailStatus: "enviado",
    emailedAt: new Date(),
    status: "enviada",
    emailError: null,
  });

  return {
    success: true,
    emailData: buildEmailPreview({
      to: supplierEmail,
      subject: `Orden de Compra ${detail.purchaseOrder.orderNumber}`,
      lines: [
        `Estimado proveedor ${detail.supplier?.name ?? ""}`.trim(),
        "",
        `Adjuntamos la Orden de Compra ${detail.purchaseOrder.orderNumber}.`,
        `Proyecto: ${detail.project?.code ?? ""} ${detail.project?.name ?? ""}`.trim(),
        `Fecha necesaria: ${formatDateLabel(detail.purchaseOrder.neededBy)}`,
        `Total OC: ${formatPurchaseOrderCurrency(detail.summary?.total ?? 0)}`,
        "",
        "Saludos,",
        "Equipo BuildReq",
      ],
    }),
  };
}

export async function createTransferRequest(
  data: Omit<InsertTransferRequest, "requestNumber">,
  items: Omit<InsertTransferRequestItem, "transferRequestId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const requestNumber = await generateTransferRequestNumber(data.projectId);
  const [created] = await db
    .insert(transferRequests)
    .values({ ...data, requestNumber })
    .returning({ id: transferRequests.id });

  if (items.length > 0) {
    await db.insert(transferRequestItems).values(
      items.map(item => ({
        ...item,
        transferRequestId: created.id,
      }))
    );
  }

  return { id: created.id, requestNumber };
}

export async function listTransferRequests(filters?: {
  projectId?: number;
  projectIds?: number[];
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId)
    conditions.push(eq(transferRequests.projectId, filters.projectId));
  if (filters?.projectIds) {
    if (filters.projectIds.length === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(
        or(
          inArray(transferRequests.projectId, filters.projectIds),
          inArray(transferRequests.destinationProjectId, filters.projectIds)
        )!
      );
    }
  }
  if (filters?.status)
    conditions.push(eq(transferRequests.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      transferRequest: transferRequests,
      project: projects,
      materialRequest: materialRequests,
    })
    .from(transferRequests)
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(transferRequests.materialRequestId, materialRequests.id)
    )
    .where(where)
    .orderBy(desc(transferRequests.createdAt));
}

export async function getTransferRequestById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      transferRequest: transferRequests,
      project: projects,
      materialRequest: materialRequests,
    })
    .from(transferRequests)
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(transferRequests.materialRequestId, materialRequests.id)
    )
    .where(eq(transferRequests.id, id))
    .limit(1);
  if (!rows[0]) return undefined;
  const items = await db
    .select()
    .from(transferRequestItems)
    .where(eq(transferRequestItems.transferRequestId, id))
    .orderBy(asc(transferRequestItems.id));

  const enrichedItems = await Promise.all(
    items.map(async item => {
      const sourceWarehouse = item.sourceWarehouseId
        ? await getWarehouseById(item.sourceWarehouseId)
        : undefined;
      const currentOriginStock = item.sourceWarehouseId
        ? parseDecimal(
            await getStockByItem({
              sapItemCode: item.sapItemCode,
              itemName: item.itemName,
              projectId: rows[0].transferRequest.projectId,
              warehouseId: item.sourceWarehouseId,
            })
          )
        : 0;
      const openQuantity = getTransferOpenQuantity(item);
      const stockAfterTransfer = currentOriginStock - openQuantity;

      return {
        ...item,
        sourceWarehouse: sourceWarehouse ?? null,
        originStockQuantity: toDecimalString(currentOriginStock),
        stockAfterTransfer: toDecimalString(stockAfterTransfer),
      };
    })
  );

  const destinationProject =
    rows[0].transferRequest.destinationType === "proyecto" &&
    rows[0].transferRequest.destinationProjectId
      ? await getProjectById(rows[0].transferRequest.destinationProjectId)
      : null;
  const reverseLogisticDestinationWarehouse = rows[0].transferRequest
    .reverseLogisticId
    ? ((await getReverseLogisticById(rows[0].transferRequest.reverseLogisticId))
        ?.destinationWarehouse ?? null)
    : null;
  const selectedDestinationWarehouse = rows[0].transferRequest
    .destinationWarehouseId
    ? ((await getWarehouseById(
        rows[0].transferRequest.destinationWarehouseId
      )) ?? null)
    : null;

  return {
    ...rows[0],
    destinationProject,
    destinationWarehouse:
      reverseLogisticDestinationWarehouse ??
      selectedDestinationWarehouse ??
      destinationProject?.warehouse ??
      null,
    items: enrichedItems,
  };
}

export async function updateTransferRequest(
  id: number,
  data: Partial<InsertTransferRequest>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(transferRequests)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(transferRequests.id, id));
  return { success: true };
}

export async function createTransferFromRequest(
  transferRequestId: number,
  confirmedById: number,
  itemQuantities?: Array<{
    transferRequestItemId: number;
    quantity: string | number;
    sourceProjectId?: number | null;
    sourceWarehouseId?: number | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const detail = await getTransferRequestById(transferRequestId);
  if (!detail) throw new Error("Solicitud de traslado no encontrada");

  const quantityByItemId = new Map<number, number>();
  const sourceByItemId = new Map<
    number,
    { sourceProjectId?: number | null; sourceWarehouseId?: number | null }
  >();
  for (const item of itemQuantities ?? []) {
    quantityByItemId.set(
      item.transferRequestItemId,
      parseDecimal(item.quantity)
    );
    sourceByItemId.set(item.transferRequestItemId, {
      sourceProjectId: item.sourceProjectId ?? null,
      sourceWarehouseId: item.sourceWarehouseId ?? null,
    });
  }

  const requestedItems = detail.items || [];
  const transferItems = requestedItems.map(item => {
    const requestedQuantity = parseDecimal(item.quantity);
    const transferQuantity = itemQuantities
      ? (quantityByItemId.get(item.id) ?? 0)
      : requestedQuantity;
    const pendingQuantity = Math.max(requestedQuantity - transferQuantity, 0);
    const selectedSource = sourceByItemId.get(item.id);
    const sourceProjectId = selectedSource
      ? (selectedSource.sourceProjectId ?? null)
      : detail.transferRequest.projectId;
    const sourceWarehouseId =
      selectedSource?.sourceWarehouseId ?? item.sourceWarehouseId ?? null;

    if (transferQuantity < 0) {
      throw new Error("La cantidad a trasladar no puede ser negativa");
    }
    if (transferQuantity - requestedQuantity > 0.000001) {
      throw new Error(
        `La cantidad a trasladar de ${item.itemName} no puede exceder lo solicitado`
      );
    }
    if (transferQuantity > 0 && !sourceWarehouseId) {
      throw new Error(`Seleccione almacén origen para ${item.itemName}`);
    }
    if (transferQuantity > 0 && !sourceProjectId) {
      throw new Error(`Seleccione proyecto/bodega origen para ${item.itemName}`);
    }
    return {
      item,
      requestedQuantity,
      transferQuantity,
      pendingQuantity,
      sourceProjectId,
      sourceWarehouseId,
    };
  });

  if (!transferItems.some(entry => entry.transferQuantity > 0)) {
    throw new Error("Debe trasladar al menos una cantidad mayor que cero");
  }

  const positiveSourceOrigins = Array.from(
    new Set(
      transferItems
        .filter(entry => entry.transferQuantity > 0)
        .map(entry => `project:${entry.sourceProjectId}`)
    )
  );
  if (positiveSourceOrigins.length !== 1) {
    throw new Error(
      "Seleccione bodegas origen del mismo proyecto para convertir esta solicitud"
    );
  }
  const selectedSourceOrigin = positiveSourceOrigins[0];
  const selectedSourceProjectId = selectedSourceOrigin.startsWith("project:")
    ? Number(selectedSourceOrigin.replace("project:", ""))
    : detail.transferRequest.projectId;
  const sourceProject = await getProjectById(selectedSourceProjectId);
  const sourceProjectLabel = sourceProject?.code ?? selectedSourceProjectId;

  const affectedRequestIds = new Set<number>();

  for (const entry of transferItems) {
    const item = entry.item;

    if (entry.transferQuantity > 0) {
      await db
        .update(transferRequestItems)
        .set({
          quantity: toDecimalString(entry.transferQuantity),
          sourceWarehouseId: entry.sourceWarehouseId,
          updatedAt: new Date(),
        })
        .where(eq(transferRequestItems.id, item.id));
    } else {
      await db
        .delete(transferRequestItems)
        .where(eq(transferRequestItems.id, item.id));
    }

    if (!item.materialRequestItemId) continue;

    const [requestItem] = await db
      .select()
      .from(requestItems)
      .where(eq(requestItems.id, item.materialRequestItemId))
      .limit(1);
    if (!requestItem) continue;

    affectedRequestIds.add(requestItem.requestId);

    const activeFlowConditions = and(
      eq(supplyFlowRecords.requestItemId, requestItem.id),
      eq(supplyFlowRecords.flowType, "traslado_proyecto"),
      sql`${supplyFlowRecords.status} <> 'cancelado'`
    );

    if (entry.transferQuantity > 0) {
      await db
        .update(requestItems)
        .set({
          quantity: toDecimalString(entry.transferQuantity),
          deliveredQuantity: toDecimalString(
            Math.min(
              Math.max(parseDecimal(requestItem.deliveredQuantity), 0),
              entry.transferQuantity
            )
          ),
          assignedFlow: "traslado_proyecto",
          status: "pendiente",
          updatedAt: new Date(),
        })
        .where(eq(requestItems.id, requestItem.id));

      await db
        .update(supplyFlowRecords)
        .set({
          status: "completado",
          processedById: confirmedById,
          updatedAt: new Date(),
        })
        .where(activeFlowConditions);
    } else {
      await db
        .update(requestItems)
        .set({
          assignedFlow: null,
          status: "pendiente",
          updatedAt: new Date(),
        })
        .where(eq(requestItems.id, requestItem.id));

      await db
        .update(supplyFlowRecords)
        .set({
          status: "cancelado",
          notes: `Saldo devuelto al flujo por traslado parcial ${detail.transferRequest.requestNumber}`,
          updatedAt: new Date(),
        })
        .where(activeFlowConditions);
    }

    if (entry.pendingQuantity > 0 && entry.transferQuantity > 0) {
      await createRequestItem({
        requestId: requestItem.requestId,
        itemName: requestItem.itemName,
        quantity: toDecimalString(entry.pendingQuantity),
        unit: requestItem.unit,
        approvalStatus: requestItem.approvalStatus,
        approvedById: requestItem.approvedById,
        approvedAt: requestItem.approvedAt,
        rejectionReason: requestItem.rejectionReason,
        sapItemCode: requestItem.sapItemCode,
        sapItemDescription: requestItem.sapItemDescription,
        assignedFlow: null,
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
        committedQuantity: requestItem.committedQuantity ?? "0.00",
        projectStock: requestItem.projectStock ?? "0.00",
        sapStock: requestItem.sapStock ?? "0.00",
        warehouseExitNote: null,
        status: "pendiente",
        notes: [
          requestItem.notes,
          `Saldo pendiente de ${toDecimalString(entry.pendingQuantity)} ${requestItem.unit ?? ""} liberado para elegir otro flujo por traslado parcial ${detail.transferRequest.requestNumber}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }
  }

  const transferNumber = await generateTransferNumber(selectedSourceProjectId);
  const guideNumber = await generateRemissionGuideNumber(
    selectedSourceProjectId
  );
  const sapCorrelative = `SAP-${guideNumber}`;
  const documentContent = buildSimplePdfBase64(
    `Guía de Remisión ${guideNumber}`,
    [
      `Traslado: ${transferNumber}`,
      `Solicitud de traslado: ${detail.transferRequest.requestNumber}`,
      `Proyecto origen: ${sourceProjectLabel}`,
      `Destino: ${
        detail.transferRequest.destinationType === "bodega_central"
          ? "Proyecto/bodega destino en recepción"
          : `Proyecto ${detail.transferRequest.destinationProjectId ?? ""}`
      }`,
      `Correlativo SAP: ${sapCorrelative}`,
    ]
  );

  const [transfer] = await db
    .insert(transfers)
    .values({
      transferNumber,
      transferRequestId,
      status: "confirmado",
      remissionGuideNumber: guideNumber,
      sapCorrelative,
      confirmedById,
      confirmedAt: new Date(),
    })
    .returning({ id: transfers.id });

  await db.insert(remissionGuides).values({
    guideNumber,
    transferId: transfer.id,
    sapCorrelative,
    documentName: `${guideNumber}.pdf`,
    documentMimeType: "application/pdf",
    documentContent,
  });

  await updateTransferRequest(transferRequestId, {
    projectId: selectedSourceProjectId,
    status: "convertida",
  });
  if (detail.transferRequest.reverseLogisticId) {
    await updateReverseLogisticStatus(
      detail.transferRequest.reverseLogisticId,
      "en_transito",
      confirmedById
    );
  }

  for (const requestId of Array.from(affectedRequestIds)) {
    await updateMaterialRequestStatus(requestId, "en_proceso", confirmedById);
  }

  return { id: transfer.id, transferNumber, guideNumber, sapCorrelative };
}

export async function listTransfers(filters?: {
  status?: string;
  receivableOnly?: boolean;
  sourceProjectId?: number;
  destinationProjectId?: number;
  projectIds?: number[];
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.status)
    conditions.push(eq(transfers.status, filters.status as any));
  if (filters?.receivableOnly) {
    conditions.push(
      inArray(transfers.status, [
        "confirmado",
        "en_transito",
        "parcialmente_recibido",
      ])
    );
  }
  if (filters?.sourceProjectId) {
    conditions.push(eq(transferRequests.projectId, filters.sourceProjectId));
  }
  if (filters?.destinationProjectId) {
    conditions.push(
      eq(transferRequests.destinationProjectId, filters.destinationProjectId)
    );
  }
  if (filters?.projectIds) {
    if (filters.projectIds.length === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(
        or(
          inArray(transferRequests.projectId, filters.projectIds),
          inArray(transferRequests.destinationProjectId, filters.projectIds)
        )!
      );
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select({
      transfer: transfers,
      transferRequest: transferRequests,
      project: projects,
    })
    .from(transfers)
    .leftJoin(
      transferRequests,
      eq(transfers.transferRequestId, transferRequests.id)
    )
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .where(where)
    .orderBy(desc(transfers.createdAt));

  const destinationProjectIds = Array.from(
    new Set(
      rows
        .map(row =>
          row.transferRequest?.destinationType === "proyecto"
            ? row.transferRequest.destinationProjectId
            : null
        )
        .filter((value): value is number => typeof value === "number")
    )
  );

  const destinationRows =
    destinationProjectIds.length > 0
      ? await db
          .select()
          .from(projects)
          .where(inArray(projects.id, destinationProjectIds))
      : [];
  const destinationProjectsById = new Map(
    destinationRows.map(project => [project.id, project])
  );

  return rows.map(row => ({
    ...row,
    destinationProject:
      row.transferRequest?.destinationType === "proyecto" &&
      row.transferRequest.destinationProjectId
        ? (destinationProjectsById.get(
            row.transferRequest.destinationProjectId
          ) ?? null)
        : null,
  }));
}

export async function getTransferById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      transfer: transfers,
      transferRequest: transferRequests,
      project: projects,
      remissionGuide: remissionGuides,
      createdBy: users,
    })
    .from(transfers)
    .leftJoin(
      transferRequests,
      eq(transfers.transferRequestId, transferRequests.id)
    )
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(remissionGuides, eq(remissionGuides.transferId, transfers.id))
    .leftJoin(users, eq(transferRequests.createdById, users.id))
    .where(eq(transfers.id, id))
    .limit(1);
  if (!rows[0]) return undefined;

  const destinationProject =
    rows[0].transferRequest?.destinationType === "proyecto" &&
    rows[0].transferRequest.destinationProjectId
      ? await getProjectById(rows[0].transferRequest.destinationProjectId)
      : null;
  const reverseLogisticDestinationWarehouse = rows[0].transferRequest
    ?.reverseLogisticId
    ? ((await getReverseLogisticById(rows[0].transferRequest.reverseLogisticId))
        ?.destinationWarehouse ?? null)
    : null;
  const selectedDestinationWarehouse = rows[0].transferRequest
    ?.destinationWarehouseId
    ? ((await getWarehouseById(
        rows[0].transferRequest.destinationWarehouseId
      )) ?? null)
    : null;
  const originProject = rows[0].transferRequest?.projectId
    ? await getProjectById(rows[0].transferRequest.projectId)
    : null;
  const transferItems = await db
    .select()
    .from(transferRequestItems)
    .where(
      eq(
        transferRequestItems.transferRequestId,
        rows[0].transferRequest?.id ?? 0
      )
    );
  const items = await Promise.all(
    transferItems.map(async item => {
      const [requestItemTarget] = item.materialRequestItemId
        ? await db
            .select({
              item: requestItems,
              subproject: projectSubprojects,
            })
            .from(requestItems)
            .leftJoin(
              projectSubprojects,
              eq(requestItems.subProjectId, projectSubprojects.id)
            )
            .where(eq(requestItems.id, item.materialRequestItemId))
            .limit(1)
        : [];
      const target = requestItemTarget
        ? mapMaterialRequestTarget(
            requestItemTarget.item,
            requestItemTarget.subproject
          )
        : null;

      return {
        ...item,
        sourceWarehouse: item.sourceWarehouseId
          ? ((await getWarehouseById(item.sourceWarehouseId)) ?? null)
          : null,
        target,
        targetLabel: requestItemTarget
          ? buildWarehouseExitTargetLabel({
              targetType: requestItemTarget.item.targetType,
              subProjectId: requestItemTarget.item.subProjectId,
              subproject: requestItemTarget.subproject,
              fixedAssetSapItemCode:
                requestItemTarget.item.fixedAssetSapItemCode,
              fixedAssetName: requestItemTarget.item.fixedAssetName,
            })
          : null,
      };
    })
  );

  return {
    ...rows[0],
    originWarehouse: originProject?.warehouse ?? null,
    destinationProject,
    destinationWarehouse:
      reverseLogisticDestinationWarehouse ??
      selectedDestinationWarehouse ??
      destinationProject?.warehouse ??
      null,
    createdBy: rows[0].createdBy
      ? {
          id: rows[0].createdBy.id,
          name: rows[0].createdBy.name,
          email: rows[0].createdBy.email,
        }
      : null,
    items,
  };
}

export async function updateTransferPrintFields(
  id: number,
  data: {
    preparedByName?: string | null;
    deliveredToName?: string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [transfer] = await db
    .update(transfers)
    .set({
      preparedByName: data.preparedByName?.trim() || null,
      deliveredToName: data.deliveredToName?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(transfers.id, id))
    .returning();

  return transfer;
}

function hasReceiptItemFinancialSnapshot(
  receiptItem: Pick<InsertReceiptItem, "subtotal" | "taxAmount" | "total">
) {
  return (
    parseDecimal(receiptItem.subtotal) > 0 ||
    parseDecimal(receiptItem.taxAmount) > 0 ||
    parseDecimal(receiptItem.total) > 0
  );
}

type ReceiptOtherChargeInput = {
  concept: string;
  amount: string | number;
};

type InsertedReceiptOtherCharge = ReceiptOtherChargeInput & {
  insertedReceiptOtherChargeId: number;
  createdAt?: Date | null;
};

function normalizeReceiptOtherChargesForInsert(
  charges: ReceiptOtherChargeInput[] | undefined
) {
  return (charges ?? [])
    .map(charge => ({
      concept: String(charge.concept ?? "").trim(),
      amount: toMoneyString4(charge.amount),
    }))
    .filter(charge => charge.concept && parseDecimal(charge.amount) > 0);
}

function sumOtherChargesTotal(
  charges: Array<{ amount: string | number | null | undefined }>
) {
  return roundMoney(
    charges.reduce((sum, charge) => sum + parseDecimal(charge.amount), 0)
  );
}

type FiscalRangeInvoiceSnapshot = Pick<
  Invoice,
  | "id"
  | "supplierId"
  | "isFiscalDocument"
  | "cai"
  | "documentRangeStart"
  | "documentRangeEnd"
  | "emissionDeadline"
>;

function buildSupplierFiscalDocumentRangePayload(
  invoice: FiscalRangeInvoiceSnapshot,
  supplier: Pick<Supplier, "id" | "rtn"> | null | undefined
): InsertSupplierFiscalDocumentRange | null {
  if (invoice.isFiscalDocument !== true) return null;
  if (!invoice.emissionDeadline) return null;

  const supplierRtn = String(supplier?.rtn ?? "").trim();
  const supplierRtnNormalized = normalizeFiscalRtn(supplierRtn);
  if (!supplierRtn || !supplierRtnNormalized) return null;

  const cai = formatCaiInput(invoice.cai);
  const documentRangeStart = formatInvoiceNumberInput(
    invoice.documentRangeStart
  );
  const documentRangeEnd = formatInvoiceNumberInput(invoice.documentRangeEnd);
  if (
    !isValidCai(cai) ||
    !isValidInvoiceNumber(documentRangeStart) ||
    !isValidInvoiceNumber(documentRangeEnd) ||
    !isFiscalInvoiceRangeOrdered({ documentRangeStart, documentRangeEnd })
  ) {
    return null;
  }

  const documentRangeStartKey = getFiscalInvoiceNumberKey(documentRangeStart);
  const documentRangeEndKey = getFiscalInvoiceNumberKey(documentRangeEnd);
  if (!documentRangeStartKey || !documentRangeEndKey) return null;

  return {
    supplierId: supplier?.id ?? invoice.supplierId ?? null,
    supplierRtn,
    supplierRtnNormalized,
    cai,
    documentRangeStart,
    documentRangeEnd,
    documentRangeStartKey,
    documentRangeEndKey,
    emissionDeadline: invoice.emissionDeadline,
    sourceInvoiceId: invoice.id,
    updatedAt: new Date(),
  };
}

async function upsertSupplierFiscalDocumentRange(params: {
  invoice: FiscalRangeInvoiceSnapshot;
  supplier: Pick<Supplier, "id" | "rtn"> | null | undefined;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const payload = buildSupplierFiscalDocumentRangePayload(
    params.invoice,
    params.supplier
  );
  if (!payload) return null;

  const [range] = await db
    .insert(supplierFiscalDocumentRanges)
    .values(payload)
    .onConflictDoUpdate({
      target: [
        supplierFiscalDocumentRanges.supplierRtnNormalized,
        supplierFiscalDocumentRanges.cai,
        supplierFiscalDocumentRanges.documentRangeStartKey,
        supplierFiscalDocumentRanges.documentRangeEndKey,
      ],
      set: {
        supplierId: payload.supplierId,
        supplierRtn: payload.supplierRtn,
        emissionDeadline: payload.emissionDeadline,
        sourceInvoiceId: payload.sourceInvoiceId,
        updatedAt: new Date(),
      },
    })
    .returning();

  return range ?? null;
}

async function upsertSupplierFiscalDocumentRangeForInvoiceId(
  invoiceId: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [row] = await db
    .select({
      invoice: invoices,
      supplier: suppliers,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!row) return null;
  return upsertSupplierFiscalDocumentRange(row);
}

async function createInvoiceFromPurchaseOrderReceipt(params: {
  receiptId: number;
  purchaseOrderDetail: NonNullable<
    Awaited<ReturnType<typeof getPurchaseOrderById>>
  >;
  receiptData: Omit<InsertReceipt, "receiptNumber"> & {
    emissionDeadline?: Date | null;
  };
  receiptItems: Array<
    Omit<InsertReceiptItem, "receiptId"> & {
      insertedReceiptItemId: number;
    }
  >;
  receiptOtherCharges?: InsertedReceiptOtherCharge[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const emissionDeadline = params.receiptData.emissionDeadline;
  if (params.receiptData.isFiscalDocument && !emissionDeadline) {
    throw new Error("La fecha límite de emisión es requerida para facturas");
  }
  if (
    params.receiptData.isFiscalDocument &&
    !params.receiptData.documentDueDate
  ) {
    throw new Error(
      "La fecha de vencimiento del documento es requerida para facturas"
    );
  }
  const invoiceEmissionDeadline =
    emissionDeadline ??
    params.receiptData.documentDate ??
    params.receiptData.receiptDate ??
    params.receiptData.postingDate;

  const itemById = new Map(
    (params.purchaseOrderDetail.items ?? []).map((item: any) => [item.id, item])
  );
  const invoiceLines = params.receiptItems
    .map(receiptItem => {
      const sourceItem = itemById.get(receiptItem.sourceItemId);
      const useReceiptFinancials =
        hasReceiptItemFinancialSnapshot(receiptItem) || !sourceItem;
      const amounts = calculatePurchaseOrderLineAmounts({
        quantity: receiptItem.quantityReceived,
        unitPrice: receiptItem.unitPrice ?? sourceItem?.unitPrice ?? "0.00",
        taxCode: useReceiptFinancials
          ? receiptItem.taxCode
          : sourceItem.taxCode,
        additionalTaxCodes: useReceiptFinancials
          ? receiptItem.additionalTaxCodes
          : sourceItem.additionalTaxCodes,
        taxBreakdown: useReceiptFinancials
          ? receiptItem.taxBreakdown
          : sourceItem.taxBreakdown,
      });

      return {
        receiptItem,
        sourceItem,
        amounts,
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line));
  const catalogCodes = Array.from(
    new Set(
      invoiceLines
        .flatMap(({ receiptItem, sourceItem }) => [
          sourceItem?.currentSapItemCode,
          sourceItem?.originalSapItemCode,
          receiptItem.sapItemCode,
        ])
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        )
    )
  );
  const catalogRows =
    catalogCodes.length > 0
      ? await db
          .select({
            itemCode: sapCatalog.itemCode,
            allowsTaxWithholding: sapCatalog.allowsTaxWithholding,
          })
          .from(sapCatalog)
          .where(inArray(sapCatalog.itemCode, catalogCodes))
      : [];
  const catalogByCode = new Map(catalogRows.map(row => [row.itemCode, row]));

  const totals = invoiceLines.reduce(
    (summary, { amounts }) => {
      summary.subtotal += amounts.subtotal;
      summary.taxAmount += amounts.taxAmount;
      summary.total += amounts.total;
      return summary;
    },
    { subtotal: 0, taxAmount: 0, total: 0 }
  );
  const otherChargesTotal = sumOtherChargesTotal(
    params.receiptOtherCharges ?? []
  );
  const invoiceTotal = roundMoney(totals.total + otherChargesTotal);
  const invoiceDocumentNumber = await generateInvoiceDocumentNumber(
    params.purchaseOrderDetail.purchaseOrder.projectId
  );

  const [createdInvoice] = await db
    .insert(invoices)
    .values({
      invoiceDocumentNumber,
      receiptId: params.receiptId,
      purchaseOrderId: params.purchaseOrderDetail.purchaseOrder.id,
      projectId: params.purchaseOrderDetail.purchaseOrder.projectId,
      supplierId: params.purchaseOrderDetail.purchaseOrder.supplierId ?? null,
      status: "borrador",
      isFiscalDocument: params.receiptData.isFiscalDocument ?? false,
      cai: params.receiptData.cai ?? null,
      invoiceNumber: params.receiptData.invoiceNumber ?? null,
      documentRangeStart: params.receiptData.documentRangeStart ?? null,
      documentRangeEnd: params.receiptData.documentRangeEnd ?? null,
      documentDate: params.receiptData.documentDate ?? null,
      documentDueDate: params.receiptData.documentDueDate ?? null,
      postingDate: params.receiptData.postingDate,
      receiptDate: params.receiptData.receiptDate,
      emissionDeadline: invoiceEmissionDeadline,
      notes: params.receiptData.notes ?? null,
      subtotal: toMoneyString4(totals.subtotal),
      taxAmount: toMoneyString4(totals.taxAmount),
      total: toMoneyString4(invoiceTotal),
      retentionTotal: "0.0000",
      netPayable: toMoneyString4(invoiceTotal),
    } as any)
    .returning({
      id: invoices.id,
      invoiceDocumentNumber: invoices.invoiceDocumentNumber,
    });

  await upsertSupplierFiscalDocumentRangeForInvoiceId(createdInvoice.id);

  if (invoiceLines.length > 0) {
    await db.insert(invoiceItems).values(
      invoiceLines.map(({ receiptItem, sourceItem, amounts }) => {
        const currentSapItemCode =
          receiptItem.sapItemCode ?? sourceItem?.currentSapItemCode ?? null;
        const originalSapItemCode =
          sourceItem?.originalSapItemCode ?? receiptItem.sapItemCode ?? null;
        const catalogItem =
          catalogByCode.get(currentSapItemCode ?? "") ??
          catalogByCode.get(originalSapItemCode ?? "");
        return {
          invoiceId: createdInvoice.id,
          receiptItemId: receiptItem.insertedReceiptItemId,
          purchaseOrderItemId: sourceItem?.id ?? null,
          itemName: receiptItem.itemName,
          currentSapItemCode,
          originalSapItemCode,
          quantity: toDecimalString(receiptItem.quantityReceived),
          unit: receiptItem.unit ?? sourceItem?.unit ?? null,
          unitPrice: toMoneyString4(
            receiptItem.unitPrice ?? sourceItem?.unitPrice ?? "0.00"
          ),
          taxCode: amounts.taxCode,
          additionalTaxCodes: amounts.additionalTaxCodes,
          targetType: receiptItem.targetType ?? sourceItem?.targetType ?? null,
          subProjectId:
            (receiptItem.targetType ?? sourceItem?.targetType) === "subproyecto"
              ? (receiptItem.subProjectId ?? sourceItem?.subProjectId ?? null)
              : null,
          fixedAssetSapItemCode:
            (receiptItem.targetType ?? sourceItem?.targetType) === "activo_fijo"
              ? (receiptItem.fixedAssetSapItemCode ??
                sourceItem?.fixedAssetSapItemCode ??
                null)
              : null,
          fixedAssetName:
            (receiptItem.targetType ?? sourceItem?.targetType) === "activo_fijo"
              ? (receiptItem.fixedAssetName ??
                sourceItem?.fixedAssetName ??
                null)
              : null,
          isFixedAsset: receiptItem.isFixedAsset ?? false,
          isLeasing:
            receiptItem.isFixedAsset === true
              ? (receiptItem.isLeasing ?? false)
              : false,
          assetDetails:
            receiptItem.isFixedAsset === true
              ? (receiptItem.assetDetails ?? [])
              : [],
          lineObservation: receiptItem.notes ?? null,
          allowsTaxWithholding: catalogItem?.allowsTaxWithholding ?? true,
          subtotal: toMoneyString4(amounts.subtotal),
          taxAmount: toMoneyString4(amounts.taxAmount),
          total: toMoneyString4(amounts.total),
          taxBreakdown: amounts.taxBreakdown,
        };
      })
    );
  }

  const invoiceOtherChargeRows = (params.receiptOtherCharges ?? []).map(
    charge =>
      ({
        invoiceId: createdInvoice.id,
        receiptOtherChargeId: charge.insertedReceiptOtherChargeId,
        concept: charge.concept,
        amount: toMoneyString4(charge.amount),
      }) satisfies InsertInvoiceOtherCharge
  );
  if (invoiceOtherChargeRows.length > 0) {
    await db.insert(invoiceOtherCharges).values(invoiceOtherChargeRows);
  }

  return createdInvoice;
}

export async function registerReceipt(
  data: Omit<InsertReceipt, "receiptNumber"> & {
    emissionDeadline?: Date | null;
  },
  items: Array<
    Omit<InsertReceiptItem, "receiptId"> & {
      closeRemaining?: boolean;
      closeReason?: string | null;
      closeNote?: string | null;
      closedById?: number | null;
      isFixedAsset?: boolean;
      isLeasing?: boolean;
      assetDetails?: FixedAssetDetail[];
    }
  >,
  otherCharges?: ReceiptOtherChargeInput[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  let purchaseOrderDetailForReceipt: Awaited<
    ReturnType<typeof getPurchaseOrderById>
  > = undefined;
  if (data.sourceType === "purchase_order") {
    purchaseOrderDetailForReceipt = await getPurchaseOrderById(data.sourceId);
    if (!purchaseOrderDetailForReceipt) {
      throw new Error("Orden de compra no encontrada");
    }

    const purchaseOrderDetailItemsById = new Map(
      (purchaseOrderDetailForReceipt.items ?? []).map((detailItem: any) => [
        detailItem.id,
        detailItem,
      ])
    );
    const isNonInventoryPurchaseOrderItem = async (item: {
      sourceItemId?: number | null;
      sapItemCode?: string | null;
      isFixedAsset?: boolean | null;
    }) => {
      if (item.sourceItemId) {
        const detailItem = purchaseOrderDetailItemsById.get(item.sourceItemId);
        const tipoArticulo = Number(
          detailItem?.catalogItem?.tipoArticulo ?? detailItem?.tipoArticulo ?? 0
        );
        const sourceCode = String(
          detailItem?.currentSapItemCode ??
            detailItem?.originalSapItemCode ??
            ""
        )
          .trim()
          .toUpperCase();
        return (
          tipoArticulo === 2 ||
          tipoArticulo === 3 ||
          detailItem?.isFixedAsset === true ||
          Boolean(detailItem?.fixedAssetArticleId) ||
          sourceCode.startsWith("AFT")
        );
      }

      if (item.isFixedAsset === true) return true;
      const sapItemCode = item.sapItemCode?.trim();
      if (!sapItemCode) return false;
      const catalogItem = await lookupSapItemByCode(sapItemCode);
      const tipoArticulo = Number(catalogItem?.tipoArticulo ?? 0);
      return (
        tipoArticulo === 2 ||
        tipoArticulo === 3 ||
        sapItemCode.toUpperCase().startsWith("AFT")
      );
    };

    for (const item of items) {
      if (parseDecimal(item.quantityReceived) <= 0) continue;
      if (await isNonInventoryPurchaseOrderItem(item)) continue;
      if (!item.warehouseId) {
        throw new Error(`Seleccione almacén destino para ${item.itemName}`);
      }
    }
  } else if (data.sourceType === "transfer") {
    for (const item of items) {
      if (parseDecimal(item.quantityReceived) <= 0) continue;
      if (!item.warehouseId) {
        throw new Error(`Seleccione almacén destino para ${item.itemName}`);
      }
    }
  }

  const receiptNumber = await generateReceiptNumber(data.projectId);
  const totalExpected = items.reduce(
    (sum, item) => sum + parseDecimal(item.quantityExpected),
    0
  );
  const totalReceived = items.reduce(
    (sum, item) => sum + parseDecimal(item.quantityReceived),
    0
  );
  const hasIncompleteClosure = items.some(item => item.closeRemaining);
  const status = hasIncompleteClosure
    ? "cierre_incompleto"
    : totalReceived === 0
      ? "pendiente"
      : totalReceived < totalExpected
        ? "parcial"
        : "completa";
  const { emissionDeadline, ...receiptData } = data;

  const [existingDraft] = await db
    .select({ id: receipts.id, receiptNumber: receipts.receiptNumber })
    .from(receipts)
    .where(
      and(
        eq(receipts.sourceType, data.sourceType),
        eq(receipts.sourceId, data.sourceId),
        eq(receipts.projectId, data.projectId),
        eq(receipts.status, "borrador")
      )
    )
    .limit(1);

  const [created] = existingDraft
    ? await db
        .update(receipts)
        .set({
          ...receiptData,
          status,
          updatedAt: new Date(),
        })
        .where(eq(receipts.id, existingDraft.id))
        .returning({ id: receipts.id })
    : await db
        .insert(receipts)
        .values({
          ...receiptData,
          receiptNumber,
          status,
        })
        .returning({ id: receipts.id });

  if (existingDraft) {
    await db.delete(receiptItems).where(eq(receiptItems.receiptId, created.id));
    await db
      .delete(receiptOtherCharges)
      .where(eq(receiptOtherCharges.receiptId, created.id));
  }

  let insertedReceiptItems: Array<
    Omit<InsertReceiptItem, "receiptId"> & {
      insertedReceiptItemId: number;
    }
  > = [];
  if (items.length > 0) {
    insertedReceiptItems = await db
      .insert(receiptItems)
      .values(
        items.map(item => {
          const {
            closeRemaining: _closeRemaining,
            closeReason: _closeReason,
            closeNote: _closeNote,
            closedById: _closedById,
            ...receiptItem
          } = item;

          return {
            ...receiptItem,
            receiptId: created.id,
          };
        })
      )
      .returning({
        insertedReceiptItemId: receiptItems.id,
        sourceItemId: receiptItems.sourceItemId,
        sapItemCode: receiptItems.sapItemCode,
        warehouseId: receiptItems.warehouseId,
        itemName: receiptItems.itemName,
        quantityExpected: receiptItems.quantityExpected,
        quantityReceived: receiptItems.quantityReceived,
        unit: receiptItems.unit,
        unitPrice: receiptItems.unitPrice,
        taxCode: receiptItems.taxCode,
        additionalTaxCodes: receiptItems.additionalTaxCodes,
        taxBreakdown: receiptItems.taxBreakdown,
        subtotal: receiptItems.subtotal,
        taxAmount: receiptItems.taxAmount,
        total: receiptItems.total,
        targetType: receiptItems.targetType,
        subProjectId: receiptItems.subProjectId,
        fixedAssetSapItemCode: receiptItems.fixedAssetSapItemCode,
        fixedAssetName: receiptItems.fixedAssetName,
        isFixedAsset: receiptItems.isFixedAsset,
        isLeasing: receiptItems.isLeasing,
        assetDetails: receiptItems.assetDetails,
        notes: receiptItems.notes,
        createdAt: receiptItems.createdAt,
      });
  }

  let insertedOtherCharges: InsertedReceiptOtherCharge[] = [];
  const normalizedOtherCharges = normalizeReceiptOtherChargesForInsert(
    data.sourceType === "purchase_order" ? otherCharges : undefined
  );
  if (normalizedOtherCharges.length > 0) {
    insertedOtherCharges = await db
      .insert(receiptOtherCharges)
      .values(
        normalizedOtherCharges.map(charge => ({
          ...charge,
          receiptId: created.id,
        }))
      )
      .returning({
        insertedReceiptOtherChargeId: receiptOtherCharges.id,
        concept: receiptOtherCharges.concept,
        amount: receiptOtherCharges.amount,
        createdAt: receiptOtherCharges.createdAt,
      });
  }

  let createdInvoice: { id: number; invoiceDocumentNumber: string } | undefined;
  if (data.sourceType === "purchase_order") {
    const purchaseOrderDetail = purchaseOrderDetailForReceipt;
    if (!purchaseOrderDetail) {
      throw new Error("Orden de compra no encontrada");
    }

    createdInvoice = await createInvoiceFromPurchaseOrderReceipt({
      receiptId: created.id,
      purchaseOrderDetail,
      receiptData: data,
      receiptItems: insertedReceiptItems,
      receiptOtherCharges: insertedOtherCharges,
    });
  }

  if (data.sourceType === "purchase_order") {
    const purchaseOrderDetail = purchaseOrderDetailForReceipt;
    if (!purchaseOrderDetail) {
      throw new Error("Orden de compra no encontrada");
    }
    const purchaseOrderDetailItemsById = new Map(
      (purchaseOrderDetail.items ?? []).map((detailItem: any) => [
        detailItem.id,
        detailItem,
      ])
    );
    const isNonInventoryPurchaseOrderItem = async (item: {
      sourceItemId?: number | null;
      sapItemCode?: string | null;
      isFixedAsset?: boolean | null;
    }) => {
      if (item.sourceItemId) {
        const detailItem = purchaseOrderDetailItemsById.get(item.sourceItemId);
        const tipoArticulo = Number(
          detailItem?.catalogItem?.tipoArticulo ?? detailItem?.tipoArticulo ?? 0
        );
        const sourceCode = String(
          detailItem?.currentSapItemCode ??
            detailItem?.originalSapItemCode ??
            ""
        )
          .trim()
          .toUpperCase();
        return (
          tipoArticulo === 2 ||
          tipoArticulo === 3 ||
          detailItem?.isFixedAsset === true ||
          Boolean(detailItem?.fixedAssetArticleId) ||
          sourceCode.startsWith("AFT")
        );
      }

      if (item.isFixedAsset === true) return true;
      const sapItemCode = item.sapItemCode?.trim();
      if (!sapItemCode) return false;
      const catalogItem = await lookupSapItemByCode(sapItemCode);
      const tipoArticulo = Number(catalogItem?.tipoArticulo ?? 0);
      return (
        tipoArticulo === 2 ||
        tipoArticulo === 3 ||
        sapItemCode.toUpperCase().startsWith("AFT")
      );
    };

    for (const item of items) {
      if (!item.sourceItemId) {
        if (await isNonInventoryPurchaseOrderItem(item)) {
          continue;
        }
        await addInventoryStock({
          sapItemCode: item.sapItemCode ?? null,
          itemName: item.itemName,
          unit: item.unit,
          projectId: purchaseOrderDetail.purchaseOrder.projectId,
          warehouseId: item.warehouseId,
          quantity: item.quantityReceived,
        });
        continue;
      }

      const [existingItem] = await db
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.id, item.sourceItemId))
        .limit(1);
      if (!existingItem) continue;
      const isNonInventoryLine = await isNonInventoryPurchaseOrderItem(item);
      const nextReceived =
        parseDecimal(existingItem.receivedQuantity) +
        parseDecimal(item.quantityReceived);
      await updatePurchaseOrderItem(existingItem.id, {
        receivedQuantity: toDecimalString(nextReceived),
      });

      if (existingItem.purchaseRequestItemId) {
        const [purchaseRequestItem] = await db
          .select()
          .from(purchaseRequestItems)
          .where(
            eq(purchaseRequestItems.id, existingItem.purchaseRequestItemId)
          )
          .limit(1);

        if (purchaseRequestItem) {
          const nextPurchaseRequestReceived =
            parseDecimal(purchaseRequestItem.receivedQuantity) +
            parseDecimal(item.quantityReceived);

          await updatePurchaseRequestItem(purchaseRequestItem.id, {
            receivedQuantity: toDecimalString(nextPurchaseRequestReceived),
          });
        }
      }

      if (existingItem.materialRequestItemId) {
        const [requestItem] = await db
          .select()
          .from(requestItems)
          .where(eq(requestItems.id, existingItem.materialRequestItemId))
          .limit(1);

        if (requestItem) {
          const requestedQuantity = parseDecimal(requestItem.quantity);
          const nextDelivered = Math.min(
            parseDecimal(requestItem.deliveredQuantity) +
              parseDecimal(item.quantityReceived),
            requestedQuantity
          );
          const nextStatus =
            nextDelivered <= 0
              ? "pendiente"
              : nextDelivered < requestedQuantity
                ? "parcial"
                : "completo";

          await db
            .update(requestItems)
            .set({
              deliveredQuantity: toDecimalString(nextDelivered),
              status: nextStatus,
              updatedAt: new Date(),
            })
            .where(eq(requestItems.id, requestItem.id));
        }
      }

      if (!isNonInventoryLine) {
        await addInventoryStock({
          sapItemCode:
            item.sapItemCode ??
            existingItem.currentSapItemCode ??
            existingItem.originalSapItemCode,
          itemName: existingItem.itemName,
          unit: existingItem.unit,
          projectId: purchaseOrderDetail.purchaseOrder.projectId,
          warehouseId: item.warehouseId,
          quantity: item.quantityReceived,
        });
      }
    }
    await syncPurchaseOrderReceiptStatus(data.sourceId);

    const materialRequestIds = Array.from(
      new Set(
        (purchaseOrderDetail.items ?? [])
          .map((orderItem: any) => orderItem.materialRequestItemId)
          .filter(
            (value: unknown): value is number => typeof value === "number"
          )
      )
    );
    if (materialRequestIds.length > 0) {
      const requestRows = await db
        .select({
          requestId: requestItems.requestId,
        })
        .from(requestItems)
        .where(inArray(requestItems.id, materialRequestIds));

      for (const requestId of Array.from(
        new Set(requestRows.map(row => row.requestId))
      )) {
        await syncMaterialRequestFulfillmentStatus(
          requestId,
          data.receivedById
        );
      }
    }
  } else {
    const transferDetail = await getTransferById(data.sourceId);
    if (transferDetail?.transfer) {
      const originProjectId = transferDetail.transferRequest?.projectId;
      const destinationProjectId =
        transferDetail.transferRequest?.destinationType === "proyecto"
          ? transferDetail.transferRequest.destinationProjectId
          : null;
      const destinationInventoryProjectId = destinationProjectId ?? data.projectId;
      const affectedRequestIds = new Set<number>();

      for (const item of items) {
        if (!item.sourceItemId) continue;
        const [existingItem] = await db
          .select()
          .from(transferRequestItems)
          .where(eq(transferRequestItems.id, item.sourceItemId))
          .limit(1);
        if (!existingItem) continue;

        const receivedQuantity = parseDecimal(item.quantityReceived);
        const closeQuantity = item.closeRemaining
          ? Math.max(
              getTransferOpenQuantity(existingItem) - receivedQuantity,
              0
            )
          : 0;
        const nextReceived =
          parseDecimal(existingItem.receivedQuantity) + receivedQuantity;
        const nextReturned =
          parseDecimal(existingItem.returnedToOriginQuantity) + closeQuantity;

        const itemUpdate: Partial<InsertTransferRequestItem> = {
          receivedQuantity: toDecimalString(nextReceived),
          updatedAt: new Date(),
        };

        if (closeQuantity > 0) {
          itemUpdate.returnedToOriginQuantity = toDecimalString(nextReturned);
          itemUpdate.receiptClosed = true;
          itemUpdate.receiptClosedAt = new Date();
          itemUpdate.receiptClosedById = item.closedById ?? data.receivedById;
          itemUpdate.receiptCloseReason = item.closeReason?.trim() || null;
          itemUpdate.receiptCloseNote = item.closeNote?.trim() || null;
        }

        await db
          .update(transferRequestItems)
          .set(itemUpdate)
          .where(eq(transferRequestItems.id, existingItem.id));

        if (existingItem.materialRequestItemId) {
          const [requestItem] = await db
            .select()
            .from(requestItems)
            .where(eq(requestItems.id, existingItem.materialRequestItemId))
            .limit(1);

          if (requestItem) {
            const requestedQuantity = parseDecimal(requestItem.quantity);
            const currentDelivered = parseDecimal(
              requestItem.deliveredQuantity
            );
            const nextDelivered = Math.min(
              currentDelivered + receivedQuantity,
              requestedQuantity
            );

            affectedRequestIds.add(requestItem.requestId);

            if (closeQuantity > 0) {
              const closureNote = [
                `Cierre incompleto del traslado ${transferDetail.transfer.transferNumber}:`,
                `${toDecimalString(closeQuantity)} ${existingItem.unit ?? ""}`.trim(),
                "devuelto(s) al proyecto origen y regresado(s) a requisición.",
                item.closeReason ? `Motivo: ${item.closeReason}.` : null,
                item.closeNote ? `Nota: ${item.closeNote}` : null,
              ]
                .filter(Boolean)
                .join(" ");

              if (nextDelivered > 0) {
                await db
                  .update(requestItems)
                  .set({
                    quantity: toDecimalString(nextDelivered),
                    deliveredQuantity: toDecimalString(nextDelivered),
                    status: "completo",
                    updatedAt: new Date(),
                  })
                  .where(eq(requestItems.id, requestItem.id));

                await createRequestItem({
                  requestId: requestItem.requestId,
                  itemName: requestItem.itemName,
                  quantity: toDecimalString(closeQuantity),
                  unit: requestItem.unit,
                  approvalStatus: requestItem.approvalStatus,
                  approvedById: requestItem.approvedById,
                  approvedAt: requestItem.approvedAt,
                  rejectionReason: requestItem.rejectionReason,
                  sapItemCode: requestItem.sapItemCode,
                  sapItemDescription: requestItem.sapItemDescription,
                  assignedFlow: null,
                  deliveredQuantity: "0.00",
                  dispatchedQuantity: "0.00",
                  committedQuantity: requestItem.committedQuantity ?? "0.00",
                  projectStock: requestItem.projectStock ?? "0.00",
                  sapStock: requestItem.sapStock ?? "0.00",
                  warehouseExitNote: null,
                  status: "pendiente",
                  notes: [requestItem.notes, closureNote]
                    .filter(Boolean)
                    .join("\n"),
                });
              } else {
                await db
                  .update(requestItems)
                  .set({
                    quantity: toDecimalString(closeQuantity),
                    deliveredQuantity: "0.00",
                    dispatchedQuantity: "0.00",
                    assignedFlow: null,
                    status: "pendiente",
                    notes: [requestItem.notes, closureNote]
                      .filter(Boolean)
                      .join("\n"),
                    updatedAt: new Date(),
                  })
                  .where(eq(requestItems.id, requestItem.id));

                await db
                  .update(supplyFlowRecords)
                  .set({
                    status: "cancelado",
                    notes: closureNote,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(supplyFlowRecords.requestItemId, requestItem.id),
                      eq(supplyFlowRecords.flowType, "traslado_proyecto"),
                      sql`${supplyFlowRecords.status} <> 'cancelado'`
                    )
                  );
              }
            } else {
              const nextStatus =
                nextDelivered <= 0
                  ? "pendiente"
                  : nextDelivered < requestedQuantity
                    ? "parcial"
                    : "completo";

              await db
                .update(requestItems)
                .set({
                  deliveredQuantity: toDecimalString(nextDelivered),
                  status: nextStatus,
                  updatedAt: new Date(),
                })
                .where(eq(requestItems.id, requestItem.id));
            }
          }
        }

        if (receivedQuantity > 0) {
          if (!originProjectId || !existingItem.sourceWarehouseId) {
            throw new Error(
              `El traslado de ${existingItem.itemName} no tiene bodega/proyecto origen completa`
            );
          }

          await consumeInventoryStock({
            sapItemCode: existingItem.sapItemCode,
            itemName: existingItem.itemName,
            projectId: originProjectId,
            warehouseId: existingItem.sourceWarehouseId,
            quantity: toDecimalString(receivedQuantity),
          });
        }

        await addInventoryStock({
          sapItemCode: existingItem.sapItemCode,
          itemName: existingItem.itemName,
          unit: existingItem.unit,
          projectId: destinationInventoryProjectId,
          warehouseId: item.warehouseId,
          quantity: item.quantityReceived,
        });
      }

      const updatedItems = await db
        .select()
        .from(transferRequestItems)
        .where(
          eq(
            transferRequestItems.transferRequestId,
            transferDetail.transferRequest?.id ?? 0
          )
        );
      const transferStatus = getTransferReceiptStatus(updatedItems);

      await db
        .update(transfers)
        .set({
          status: transferStatus,
          updatedAt: new Date(),
        })
        .where(eq(transfers.id, data.sourceId));

      if (transferDetail.transferRequest?.reverseLogisticId) {
        await updateReverseLogisticStatus(
          transferDetail.transferRequest.reverseLogisticId,
          transferStatus === "recibido" ? "recibida" : "en_transito",
          data.receivedById
        );
      }

      for (const requestId of Array.from(affectedRequestIds)) {
        await syncMaterialRequestFulfillmentStatus(
          requestId,
          data.receivedById
        );
      }
    }
  }

  return {
    id: created.id,
    receiptNumber: existingDraft?.receiptNumber ?? receiptNumber,
    status,
    invoiceId: createdInvoice?.id,
    invoiceDocumentNumber: createdInvoice?.invoiceDocumentNumber,
  };
}

export async function saveReceiptDraft(
  data: Omit<InsertReceipt, "receiptNumber" | "status">,
  items: Array<Omit<InsertReceiptItem, "receiptId">>,
  otherCharges?: ReceiptOtherChargeInput[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [existingDraft] = await db
    .select({ id: receipts.id, receiptNumber: receipts.receiptNumber })
    .from(receipts)
    .where(
      and(
        eq(receipts.sourceType, data.sourceType),
        eq(receipts.sourceId, data.sourceId),
        eq(receipts.projectId, data.projectId),
        eq(receipts.status, "borrador")
      )
    )
    .limit(1);

  const receiptNumber =
    existingDraft?.receiptNumber ??
    (await generateReceiptNumber(data.projectId));
  const receiptData = {
    ...data,
    receiptNumber,
    status: "borrador" as const,
    updatedAt: new Date(),
  };

  const [draft] = existingDraft
    ? await db
        .update(receipts)
        .set(receiptData)
        .where(eq(receipts.id, existingDraft.id))
        .returning({
          id: receipts.id,
          receiptNumber: receipts.receiptNumber,
          status: receipts.status,
        })
    : await db.insert(receipts).values(receiptData).returning({
        id: receipts.id,
        receiptNumber: receipts.receiptNumber,
        status: receipts.status,
      });

  await db.delete(receiptItems).where(eq(receiptItems.receiptId, draft.id));
  await db
    .delete(receiptOtherCharges)
    .where(eq(receiptOtherCharges.receiptId, draft.id));

  if (items.length > 0) {
    await db.insert(receiptItems).values(
      items.map(item => ({
        ...item,
        receiptId: draft.id,
      }))
    );
  }

  const normalizedOtherCharges = normalizeReceiptOtherChargesForInsert(
    data.sourceType === "purchase_order" ? otherCharges : undefined
  );
  if (normalizedOtherCharges.length > 0) {
    await db.insert(receiptOtherCharges).values(
      normalizedOtherCharges.map(charge => ({
        ...charge,
        receiptId: draft.id,
      }))
    );
  }

  return {
    ...draft,
    updated: Boolean(existingDraft),
  };
}

export async function listReceipts(filters?: {
  projectId?: number;
  projectIds?: number[];
  sourceType?: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId)
    conditions.push(eq(receipts.projectId, filters.projectId));
  if (filters?.projectIds) {
    applyProjectScope(conditions, receipts.projectId, filters.projectIds);
  }
  if (filters?.sourceType)
    conditions.push(eq(receipts.sourceType, filters.sourceType as any));
  if (filters?.status)
    conditions.push(eq(receipts.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select({
      receipt: receipts,
      invoice: invoices,
      project: projects,
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
    })
    .from(receipts)
    .leftJoin(projects, eq(receipts.projectId, projects.id))
    .leftJoin(
      purchaseOrders,
      and(
        eq(receipts.sourceType, "purchase_order" as any),
        eq(receipts.sourceId, purchaseOrders.id)
      )
    )
    .leftJoin(invoices, eq(invoices.receiptId, receipts.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(where)
    .orderBy(desc(receipts.createdAt));
}

export async function getReceiptById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const voidedByUsers = alias(users, "receipt_voided_by_users");
  const rows = await db
    .select({
      receipt: receipts,
      invoice: invoices,
      project: projects,
      warehouse: warehouses,
      purchaseOrder: purchaseOrders,
      supplier: suppliers,
      receivedBy: users,
      voidedBy: voidedByUsers,
    })
    .from(receipts)
    .leftJoin(projects, eq(receipts.projectId, projects.id))
    .leftJoin(warehouses, eq(projects.warehouseId, warehouses.id))
    .leftJoin(
      purchaseOrders,
      and(
        eq(receipts.sourceType, "purchase_order" as any),
        eq(receipts.sourceId, purchaseOrders.id)
      )
    )
    .leftJoin(invoices, eq(invoices.receiptId, receipts.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(users, eq(receipts.receivedById, users.id))
    .leftJoin(voidedByUsers, eq(receipts.voidedById, voidedByUsers.id))
    .where(eq(receipts.id, id))
    .limit(1);
  if (!rows[0]) return undefined;
  const itemRows = await db
    .select({
      item: receiptItems,
      warehouse: warehouses,
      targetSubproject: projectSubprojects,
    })
    .from(receiptItems)
    .leftJoin(warehouses, eq(receiptItems.warehouseId, warehouses.id))
    .leftJoin(
      projectSubprojects,
      eq(receiptItems.subProjectId, projectSubprojects.id)
    )
    .where(eq(receiptItems.receiptId, id))
    .orderBy(asc(receiptItems.id));
  const otherCharges = await db
    .select()
    .from(receiptOtherCharges)
    .where(eq(receiptOtherCharges.receiptId, id))
    .orderBy(asc(receiptOtherCharges.id));
  const items = itemRows.map(({ item, warehouse, targetSubproject }) => ({
    ...item,
    warehouse: warehouse ? mapWarehouseSummary(warehouse) : null,
    target: mapMaterialRequestTarget(item, targetSubproject),
  }));
  return { ...rows[0], items, otherCharges };
}

// ============================================================
// SALES TAXES
// ============================================================
export type SalesTaxListFilters = {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
};

function normalizeSalesTaxCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultSalesTaxRows() {
  return DEFAULT_SALES_TAXES.map((tax, index) => ({
    id: index + 1,
    taxCode: tax.taxCode,
    description: tax.description,
    shortLabel: tax.shortLabel ?? tax.description,
    ratePercent: toRateString(tax.ratePercent),
    taxType: tax.taxType,
    fiscalCategory: tax.fiscalCategory,
    isActive: tax.isActive !== false,
    displayOrder: tax.displayOrder ?? (index + 1) * 10,
    appliesToTaxCodes: parsePurchaseOrderAdditionalTaxCodes(
      tax.appliesToTaxCodes
    ),
    note: null,
    erpCode: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));
}

function salesTaxRowsToCatalog(rows: Array<any>): SalesTaxCatalogItem[] {
  return rows.map(row => ({
    taxCode: row.taxCode,
    description: row.description,
    shortLabel: row.shortLabel,
    ratePercent: row.ratePercent,
    taxType: row.taxType,
    fiscalCategory: row.fiscalCategory,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    appliesToTaxCodes: parsePurchaseOrderAdditionalTaxCodes(
      row.appliesToTaxCodes
    ),
  }));
}

function buildSalesTaxWhere(filters?: SalesTaxListFilters) {
  const conditions = [];

  if (filters?.search?.trim()) {
    const search = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(salesTaxes.taxCode, search),
        ilike(salesTaxes.description, search),
        ilike(salesTaxes.shortLabel, search),
        ilike(salesTaxes.erpCode, search),
        ilike(salesTaxes.note, search)
      )!
    );
  }

  if (filters?.isActive !== undefined) {
    conditions.push(eq(salesTaxes.isActive, filters.isActive));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listSalesTaxes(filters?: SalesTaxListFilters) {
  const db = await getDb();
  const requestedPage = Math.max(filters?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters?.pageSize ?? 25, 10), 200);

  if (!db) {
    const items = defaultSalesTaxRows().filter(
      row =>
        filters?.isActive === undefined || row.isActive === filters.isActive
    );
    return {
      items,
      total: items.length,
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }

  const where = buildSalesTaxWhere(filters);
  const [totalResult] = await db
    .select({ count: count() })
    .from(salesTaxes)
    .where(where);
  const total = totalResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const items = await db
    .select()
    .from(salesTaxes)
    .where(where)
    .orderBy(asc(salesTaxes.displayOrder), asc(salesTaxes.taxCode))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function listActiveSalesTaxes() {
  const db = await getDb();
  if (!db) return defaultSalesTaxRows();

  return db
    .select()
    .from(salesTaxes)
    .where(eq(salesTaxes.isActive, true))
    .orderBy(asc(salesTaxes.displayOrder), asc(salesTaxes.taxCode));
}

export async function getActiveSalesTaxCatalog() {
  return salesTaxRowsToCatalog(await listActiveSalesTaxes());
}

export async function createSalesTax(
  data: Pick<
    InsertSalesTax,
    | "taxCode"
    | "description"
    | "shortLabel"
    | "ratePercent"
    | "taxType"
    | "fiscalCategory"
    | "isActive"
    | "displayOrder"
    | "appliesToTaxCodes"
    | "note"
    | "erpCode"
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [created] = await db
    .insert(salesTaxes)
    .values({
      ...data,
      taxCode: normalizeSalesTaxCode(data.taxCode),
      ratePercent: toRateString(data.ratePercent),
      appliesToTaxCodes: parsePurchaseOrderAdditionalTaxCodes(
        data.appliesToTaxCodes as any
      ),
    })
    .returning();

  return created;
}

export async function updateSalesTax(
  id: number,
  data: Partial<
    Pick<
      InsertSalesTax,
      | "taxCode"
      | "description"
      | "shortLabel"
      | "ratePercent"
      | "taxType"
      | "fiscalCategory"
      | "isActive"
      | "displayOrder"
      | "appliesToTaxCodes"
      | "note"
      | "erpCode"
    >
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [updated] = await db
    .update(salesTaxes)
    .set({
      ...data,
      ...(data.taxCode !== undefined
        ? { taxCode: normalizeSalesTaxCode(data.taxCode) }
        : {}),
      ...(data.ratePercent !== undefined
        ? { ratePercent: toRateString(data.ratePercent) }
        : {}),
      ...(data.appliesToTaxCodes !== undefined
        ? {
            appliesToTaxCodes: parsePurchaseOrderAdditionalTaxCodes(
              data.appliesToTaxCodes as any
            ),
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(salesTaxes.id, id))
    .returning();

  return updated;
}

export async function removeSalesTax(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [tax] = await db
    .select()
    .from(salesTaxes)
    .where(eq(salesTaxes.id, id))
    .limit(1);
  if (!tax) throw new Error("Impuesto no encontrado");

  const codeJson = JSON.stringify([tax.taxCode]);
  const [usage] = await db
    .select({
      purchaseOrderCount: sql<number>`(
        SELECT count(*)::int
        FROM "purchaseOrderItems"
        WHERE "taxCode" = ${tax.taxCode}
          OR "additionalTaxCodes" @> ${codeJson}::jsonb
      )`,
      invoiceCount: sql<number>`(
        SELECT count(*)::int
        FROM "invoiceItems"
        WHERE "taxCode" = ${tax.taxCode}
          OR "additionalTaxCodes" @> ${codeJson}::jsonb
      )`,
    })
    .from(salesTaxes)
    .where(eq(salesTaxes.id, id))
    .limit(1);

  if (
    Number(usage?.purchaseOrderCount ?? 0) > 0 ||
    Number(usage?.invoiceCount ?? 0) > 0
  ) {
    const [updated] = await db
      .update(salesTaxes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(salesTaxes.id, id))
      .returning();
    return { action: "deactivated" as const, tax: updated };
  }

  await db.delete(salesTaxes).where(eq(salesTaxes.id, id));
  return { action: "deleted" as const, tax };
}

export async function preparePurchaseOrderTaxDataForLine(params: {
  quantity: string | number | null | undefined;
  unitPrice?: string | number | null | undefined;
  taxCode?: string | null | undefined;
  additionalTaxCodes?: string[] | string | null | undefined;
}) {
  const taxes = await getActiveSalesTaxCatalog();
  const requestedTaxCode = String(params.taxCode ?? "").trim();
  const taxCode = normalizePurchaseOrderTaxCode(params.taxCode, taxes);
  const additionalTaxCodes = parsePurchaseOrderAdditionalTaxCodes(
    params.additionalTaxCodes
  );
  const error = getPurchaseOrderTaxSelectionError({
    taxCode: requestedTaxCode || taxCode,
    additionalTaxCodes,
    taxes,
  });
  if (error) throw new Error(error);

  const amounts = calculatePurchaseOrderLineAmounts({
    quantity: params.quantity,
    unitPrice: params.unitPrice,
    taxCode,
    additionalTaxCodes,
    taxes,
  });

  return {
    taxCode: amounts.taxCode,
    additionalTaxCodes: amounts.additionalTaxCodes,
    taxBreakdown: amounts.taxBreakdown,
  };
}

export function prepareReceiptItemFinancialDataForLine(params: {
  quantity: string | number | null | undefined;
  unitPrice?: string | number | null | undefined;
  taxCode?: string | null | undefined;
  additionalTaxCodes?: string[] | string | null | undefined;
  taxes?: SalesTaxCatalogItem[] | null;
}) {
  const taxes = params.taxes?.length ? params.taxes : DEFAULT_SALES_TAXES;
  const requestedTaxCode = String(params.taxCode ?? "").trim();
  const taxCode = normalizePurchaseOrderTaxCode(params.taxCode, taxes);
  const additionalTaxCodes = parsePurchaseOrderAdditionalTaxCodes(
    params.additionalTaxCodes
  );
  const error = getPurchaseOrderTaxSelectionError({
    taxCode: requestedTaxCode || taxCode,
    additionalTaxCodes,
    taxes,
  });
  if (error) throw new Error(error);

  const amounts = calculatePurchaseOrderLineAmounts({
    quantity: params.quantity,
    unitPrice: params.unitPrice,
    taxCode,
    additionalTaxCodes,
    taxes,
  });

  return {
    taxCode: amounts.taxCode,
    additionalTaxCodes: amounts.additionalTaxCodes,
    taxBreakdown: amounts.taxBreakdown,
    subtotal: toMoneyString4(amounts.subtotal),
    taxAmount: toMoneyString4(amounts.taxAmount),
    total: toMoneyString4(amounts.total),
  };
}

// ============================================================
// TAX RETENTIONS
// ============================================================
export type TaxRetentionListFilters = {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
};

function buildTaxRetentionWhere(filters?: TaxRetentionListFilters) {
  const conditions = [];

  if (filters?.search?.trim()) {
    const search = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(taxRetentions.taxCode, search),
        ilike(taxRetentions.description, search),
        ilike(taxRetentions.erpCode, search),
        ilike(taxRetentions.note, search)
      )!
    );
  }

  if (filters?.isActive !== undefined) {
    conditions.push(eq(taxRetentions.isActive, filters.isActive));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listTaxRetentions(filters?: TaxRetentionListFilters) {
  const db = await getDb();
  const requestedPage = Math.max(filters?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters?.pageSize ?? 25, 10), 200);

  if (!db) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }

  const where = buildTaxRetentionWhere(filters);
  const [totalResult] = await db
    .select({ count: count() })
    .from(taxRetentions)
    .where(where);
  const total = totalResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const items = await db
    .select()
    .from(taxRetentions)
    .where(where)
    .orderBy(asc(taxRetentions.taxCode))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function listActiveTaxRetentions() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(taxRetentions)
    .where(eq(taxRetentions.isActive, true))
    .orderBy(asc(taxRetentions.taxCode));
}

export async function createTaxRetention(
  data: Pick<
    InsertTaxRetention,
    "taxCode" | "description" | "ratePercent" | "isActive" | "note" | "erpCode"
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [retention] = await db
    .insert(taxRetentions)
    .values({
      ...data,
      ratePercent: toRateString(data.ratePercent),
    })
    .returning();

  return retention;
}

export async function updateTaxRetention(
  id: number,
  data: Partial<
    Pick<
      InsertTaxRetention,
      | "taxCode"
      | "description"
      | "ratePercent"
      | "isActive"
      | "note"
      | "erpCode"
    >
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [retention] = await db
    .update(taxRetentions)
    .set({
      ...data,
      ...(data.ratePercent !== undefined
        ? { ratePercent: toRateString(data.ratePercent) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(taxRetentions.id, id))
    .returning();

  if (!retention) {
    throw new Error("Retención no encontrada");
  }

  return retention;
}

export async function listInvoices(filters?: {
  projectId?: number;
  projectIds?: number[];
  status?: string;
  statuses?: string[];
  excludeStatus?: string;
  supplierId?: number;
  search?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const invoiceCreatedByUsers = alias(users, "invoice_list_created_by_users");
  const conditions = [];
  if (filters?.projectId)
    conditions.push(eq(invoices.projectId, filters.projectId));
  if (filters?.projectIds) {
    applyProjectScope(conditions, invoices.projectId, filters.projectIds);
  }
  if (filters?.status)
    conditions.push(eq(invoices.status, filters.status as any));
  if (filters?.statuses?.length)
    conditions.push(inArray(invoices.status, filters.statuses as any));
  if (filters?.excludeStatus)
    conditions.push(sql`${invoices.status} <> ${filters.excludeStatus}`);
  if (filters?.supplierId)
    conditions.push(eq(invoices.supplierId, filters.supplierId));
  const normalizedSearch = filters?.search?.trim();
  if (normalizedSearch) {
    const searchPattern = `%${normalizedSearch}%`;
    const requestSearchRequestedByUsers = alias(
      users,
      "invoice_request_search_requested_by_users"
    );
    const requestSearchRows = await db
      .select({
        invoiceId: invoiceItems.invoiceId,
      })
      .from(invoiceItems)
      .leftJoin(
        purchaseOrderItems,
        eq(invoiceItems.purchaseOrderItemId, purchaseOrderItems.id)
      )
      .leftJoin(
        requestItems,
        eq(purchaseOrderItems.materialRequestItemId, requestItems.id)
      )
      .leftJoin(
        materialRequests,
        eq(requestItems.requestId, materialRequests.id)
      )
      .leftJoin(
        requestSearchRequestedByUsers,
        eq(materialRequests.requestedById, requestSearchRequestedByUsers.id)
      )
      .where(
        or(
          ilike(materialRequests.requestNumber, searchPattern),
          ilike(requestSearchRequestedByUsers.name, searchPattern),
          ilike(requestSearchRequestedByUsers.email, searchPattern)
        )
      );
    const invoiceIdsMatchingRequestSearch = Array.from(
      new Set(requestSearchRows.map(row => row.invoiceId))
    );
    conditions.push(
      or(
        ilike(invoices.invoiceDocumentNumber, searchPattern),
        ilike(invoices.invoiceNumber, searchPattern),
        ilike(invoices.documentRangeStart, searchPattern),
        ilike(invoices.documentRangeEnd, searchPattern),
        ilike(invoices.cai, searchPattern),
        ilike(purchaseOrders.orderNumber, searchPattern),
        ilike(receipts.receiptNumber, searchPattern),
        ilike(suppliers.supplierCode, searchPattern),
        ilike(suppliers.name, searchPattern),
        ilike(projects.code, searchPattern),
        ilike(projects.name, searchPattern),
        ilike(invoiceCreatedByUsers.name, searchPattern),
        ilike(invoiceCreatedByUsers.email, searchPattern),
        invoiceIdsMatchingRequestSearch.length > 0
          ? inArray(invoices.id, invoiceIdsMatchingRequestSearch)
          : sql`false`
      )
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      invoice: invoices,
      receipt: receipts,
      purchaseOrder: purchaseOrders,
      project: projects,
      supplier: suppliers,
      createdBy: invoiceCreatedByUsers,
    })
    .from(invoices)
    .leftJoin(receipts, eq(invoices.receiptId, receipts.id))
    .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .leftJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(
      invoiceCreatedByUsers,
      eq(receipts.receivedById, invoiceCreatedByUsers.id)
    )
    .where(where)
    .orderBy(desc(invoices.createdAt));

  const invoiceIds = rows.map(row => row.invoice.id);
  if (invoiceIds.length === 0) return rows;

  const requestRows = await db
    .select({
      invoiceId: invoiceItems.invoiceId,
      requestId: materialRequests.id,
      requestNumber: materialRequests.requestNumber,
      requestedById: materialRequests.requestedById,
    })
    .from(invoiceItems)
    .leftJoin(
      purchaseOrderItems,
      eq(invoiceItems.purchaseOrderItemId, purchaseOrderItems.id)
    )
    .leftJoin(
      requestItems,
      eq(purchaseOrderItems.materialRequestItemId, requestItems.id)
    )
    .leftJoin(materialRequests, eq(requestItems.requestId, materialRequests.id))
    .where(
      and(
        inArray(invoiceItems.invoiceId, invoiceIds),
        isNotNull(materialRequests.id)
      )
    )
    .orderBy(asc(materialRequests.requestNumber));

  const requestsByInvoiceId = new Map<
    number,
    Array<{ id: number; requestNumber: string }>
  >();
  const requestedByIdsByInvoiceId = new Map<number, number[]>();
  const seenRequestIdsByInvoiceId = new Map<number, Set<number>>();
  requestRows.forEach(row => {
    if (!row.requestId || !row.requestNumber) return;
    const seenRequestIds =
      seenRequestIdsByInvoiceId.get(row.invoiceId) ?? new Set<number>();
    if (seenRequestIds.has(row.requestId)) return;
    seenRequestIds.add(row.requestId);
    seenRequestIdsByInvoiceId.set(row.invoiceId, seenRequestIds);

    const currentRows = requestsByInvoiceId.get(row.invoiceId) ?? [];
    currentRows.push({
      id: row.requestId,
      requestNumber: row.requestNumber,
    });
    requestsByInvoiceId.set(row.invoiceId, currentRows);

    if (row.requestedById) {
      const requestedByIds = requestedByIdsByInvoiceId.get(row.invoiceId) ?? [];
      if (!requestedByIds.includes(row.requestedById)) {
        requestedByIds.push(row.requestedById);
      }
      requestedByIdsByInvoiceId.set(row.invoiceId, requestedByIds);
    }
  });

  const requestedByUserIds = Array.from(
    new Set(
      Array.from(requestedByIdsByInvoiceId.values())
        .flat()
        .filter((value): value is number => typeof value === "number")
    )
  );
  const requestedByUsers =
    requestedByUserIds.length > 0
      ? await db
          .select()
          .from(users)
          .where(inArray(users.id, requestedByUserIds))
      : [];
  const requestedByUsersById = new Map(
    requestedByUsers.map(user => [user.id, user])
  );

  return rows.map(row => {
    const requestedByIds = requestedByIdsByInvoiceId.get(row.invoice.id) ?? [];
    const requestedByUsers = requestedByIds
      .map(id => requestedByUsersById.get(id))
      .filter((user): user is User => Boolean(user));

    return {
      ...row,
      materialRequests: requestsByInvoiceId.get(row.invoice.id) ?? [],
      requestedBy: requestedByUsers[0] ?? null,
      requestedByUsers,
    };
  });
}

export async function getInvoiceById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const voidedByUsers = alias(users, "invoice_voided_by_users");

  const rows = await db
    .select({
      invoice: invoices,
      receipt: receipts,
      purchaseOrder: purchaseOrders,
      project: projects,
      supplier: suppliers,
      supplierContact: supplierContacts,
      voidedBy: voidedByUsers,
    })
    .from(invoices)
    .leftJoin(receipts, eq(invoices.receiptId, receipts.id))
    .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .leftJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(
      supplierContacts,
      eq(purchaseOrders.supplierContactId, supplierContacts.id)
    )
    .leftJoin(voidedByUsers, eq(invoices.voidedById, voidedByUsers.id))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!rows[0]) return undefined;

  const [items, retentions, otherCharges] = await Promise.all([
    db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, id))
      .orderBy(asc(invoiceItems.id)),
    db
      .select()
      .from(invoiceRetentions)
      .where(eq(invoiceRetentions.invoiceId, id))
      .orderBy(asc(invoiceRetentions.id)),
    db
      .select()
      .from(invoiceOtherCharges)
      .where(eq(invoiceOtherCharges.invoiceId, id))
      .orderBy(asc(invoiceOtherCharges.id)),
  ]);

  const purchaseOrderItemIds = Array.from(
    new Set(
      items
        .map(item => item.purchaseOrderItemId)
        .filter((value): value is number => typeof value === "number")
    )
  );
  const fixedAssetArticleRows =
    purchaseOrderItemIds.length > 0
      ? await db
          .select()
          .from(sapCatalog)
          .where(
            and(
              inArray(
                sapCatalog.fixedAssetSourcePurchaseOrderItemId,
                purchaseOrderItemIds
              ),
              eq(sapCatalog.isActive, true)
            )
          )
          .orderBy(
            asc(sapCatalog.fixedAssetSourcePurchaseOrderItemId),
            asc(sapCatalog.temporaryItemCode),
            asc(sapCatalog.id)
          )
      : [];
  const fixedAssetArticlesByItemId = fixedAssetArticleRows.reduce(
    (map, article) => {
      const sourceItemId = article.fixedAssetSourcePurchaseOrderItemId;
      if (!sourceItemId) return map;
      const list = map.get(sourceItemId) ?? [];
      list.push(article);
      map.set(sourceItemId, list);
      return map;
    },
    new Map<number, typeof fixedAssetArticleRows>()
  );
  const itemsWithFixedAssetArticles = items.map(item => ({
    ...item,
    fixedAssetArticles: item.purchaseOrderItemId
      ? (fixedAssetArticlesByItemId.get(item.purchaseOrderItemId) ?? [])
      : [],
  }));

  return {
    ...rows[0],
    items: itemsWithFixedAssetArticles,
    retentions,
    otherCharges,
  };
}

export async function lookupSupplierFiscalDocumentRange(params: {
  invoiceId: number;
  invoiceNumber: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const invoiceNumberKey = getFiscalInvoiceNumberKey(params.invoiceNumber);
  if (!invoiceNumberKey) return null;

  const [invoiceRow] = await db
    .select({
      invoice: invoices,
      supplier: suppliers,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(eq(invoices.id, params.invoiceId))
    .limit(1);

  const supplierRtnNormalized = normalizeFiscalRtn(invoiceRow?.supplier?.rtn);
  if (!invoiceRow || !supplierRtnNormalized) return null;

  const [range] = await db
    .select()
    .from(supplierFiscalDocumentRanges)
    .where(
      and(
        eq(
          supplierFiscalDocumentRanges.supplierRtnNormalized,
          supplierRtnNormalized
        ),
        lte(
          supplierFiscalDocumentRanges.documentRangeStartKey,
          invoiceNumberKey
        ),
        gte(supplierFiscalDocumentRanges.documentRangeEndKey, invoiceNumberKey)
      )
    )
    .orderBy(
      desc(supplierFiscalDocumentRanges.updatedAt),
      desc(supplierFiscalDocumentRanges.id)
    )
    .limit(1);

  return range ?? null;
}

export async function lookupSupplierFiscalDocumentRangeBySupplier(params: {
  supplierRtn: string | null | undefined;
  invoiceNumber: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const invoiceNumberKey = getFiscalInvoiceNumberKey(params.invoiceNumber);
  const supplierRtnNormalized = normalizeFiscalRtn(params.supplierRtn);
  if (!invoiceNumberKey || !supplierRtnNormalized) return null;

  const [range] = await db
    .select()
    .from(supplierFiscalDocumentRanges)
    .where(
      and(
        eq(
          supplierFiscalDocumentRanges.supplierRtnNormalized,
          supplierRtnNormalized
        ),
        lte(
          supplierFiscalDocumentRanges.documentRangeStartKey,
          invoiceNumberKey
        ),
        gte(supplierFiscalDocumentRanges.documentRangeEndKey, invoiceNumberKey)
      )
    )
    .orderBy(
      desc(supplierFiscalDocumentRanges.updatedAt),
      desc(supplierFiscalDocumentRanges.id)
    )
    .limit(1);

  return range ?? null;
}

export async function updateInvoice(
  id: number,
  data: Partial<
    Pick<
      InsertInvoice,
      | "cai"
      | "isFiscalDocument"
      | "invoiceNumber"
      | "documentRangeStart"
      | "documentRangeEnd"
      | "documentDate"
      | "documentDueDate"
      | "postingDate"
      | "receiptDate"
      | "emissionDeadline"
      | "retentionReceiptNumber"
      | "notes"
    >
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [updated] = await db
    .update(invoices)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning();

  if (updated) {
    await upsertSupplierFiscalDocumentRangeForInvoiceId(updated.id);
  }

  return updated;
}

export async function updateInvoiceItemAssetDetails(
  invoiceItemId: number,
  data: Pick<
    InsertInvoiceItem,
    "isFixedAsset" | "isLeasing" | "assetDetails" | "lineObservation"
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [updated] = await db
    .update(invoiceItems)
    .set(data)
    .where(eq(invoiceItems.id, invoiceItemId))
    .returning();

  return updated;
}

export async function reviewInvoice(id: number, reviewedById: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const now = new Date();
  const [updated] = await db
    .update(invoices)
    .set({
      status: "revisada",
      reviewedById,
      reviewedAt: now,
      accountedById: null,
      accountedAt: null,
      accountingComment: null,
      rejectionComment: null,
      rejectedById: null,
      rejectedAt: null,
      updatedAt: now,
    })
    .where(eq(invoices.id, id))
    .returning();

  return updated;
}

export async function accountInvoice(params: {
  id: number;
  accountedById: number;
  accountingComment?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const now = new Date();
  const [updated] = await db
    .update(invoices)
    .set({
      status: "registrada",
      accountedById: params.accountedById,
      accountedAt: now,
      accountingComment: params.accountingComment?.trim() || null,
      updatedAt: now,
    })
    .where(eq(invoices.id, params.id))
    .returning();

  return updated;
}

export async function rejectInvoiceFromAccounting(params: {
  id: number;
  rejectedById: number;
  rejectionComment: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const now = new Date();
  const [updated] = await db
    .update(invoices)
    .set({
      status: "rechazada",
      rejectionComment: params.rejectionComment.trim(),
      rejectedById: params.rejectedById,
      rejectedAt: now,
      reviewedById: null,
      reviewedAt: null,
      accountedById: null,
      accountedAt: null,
      accountingComment: null,
      updatedAt: now,
    })
    .where(eq(invoices.id, params.id))
    .returning();

  return updated;
}

export async function correctInvoiceReceiptFromInvoice(params: {
  invoiceId: number;
  correctedById: number;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const normalizedReason = params.reason.trim();
  if (normalizedReason.length < 5) {
    throw new Error("Ingrese un motivo de corrección de al menos 5 caracteres");
  }

  const [initialRow] = await db
    .select({
      invoice: invoices,
      receipt: receipts,
    })
    .from(invoices)
    .leftJoin(receipts, eq(invoices.receiptId, receipts.id))
    .where(eq(invoices.id, params.invoiceId))
    .limit(1);

  if (!initialRow?.receipt) {
    throw new Error("Factura o recepción no encontrada");
  }

  const replacementReceiptNumber = await generateReceiptNumber(
    initialRow.receipt.projectId
  );
  const affectedRequestIds = new Set<number>();
  let affectedPurchaseOrderId = initialRow.invoice.purchaseOrderId;

  const result = await db.transaction(async tx => {
    const [row] = await tx
      .select({
        invoice: invoices,
        receipt: receipts,
        purchaseOrder: purchaseOrders,
      })
      .from(invoices)
      .leftJoin(receipts, eq(invoices.receiptId, receipts.id))
      .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
      .where(eq(invoices.id, params.invoiceId))
      .limit(1);

    if (!row?.receipt) {
      throw new Error("Factura o recepción no encontrada");
    }
    if (row.invoice.status === "registrada") {
      throw new Error("No se puede corregir una factura contabilizada");
    }
    if (row.invoice.status === "anulada") {
      throw new Error("La factura ya está anulada");
    }
    if (row.receipt.status === "anulada") {
      throw new Error("La recepción ya está anulada");
    }
    if (row.receipt.sourceType !== "purchase_order") {
      throw new Error(
        "Solo se pueden corregir recepciones de órdenes de compra"
      );
    }

    affectedPurchaseOrderId = row.invoice.purchaseOrderId;

    const [existingDraft] = await tx
      .select({
        id: receipts.id,
        receiptNumber: receipts.receiptNumber,
      })
      .from(receipts)
      .where(
        and(
          eq(receipts.sourceType, row.receipt.sourceType),
          eq(receipts.sourceId, row.receipt.sourceId),
          eq(receipts.projectId, row.receipt.projectId),
          eq(receipts.status, "borrador"),
          sql`${receipts.id} <> ${row.receipt.id}`
        )
      )
      .limit(1);
    if (existingDraft) {
      throw new Error(
        `Ya existe la recepción borrador ${existingDraft.receiptNumber} para esta OC. Edite o registre ese borrador antes de corregir esta factura.`
      );
    }

    const [items, otherCharges] = await Promise.all([
      tx
        .select()
        .from(receiptItems)
        .where(eq(receiptItems.receiptId, row.receipt.id))
        .orderBy(asc(receiptItems.id)),
      tx
        .select()
        .from(receiptOtherCharges)
        .where(eq(receiptOtherCharges.receiptId, row.receipt.id))
        .orderBy(asc(receiptOtherCharges.id)),
    ]);

    const sourceItemIds = Array.from(
      new Set(
        items
          .map(item => item.sourceItemId)
          .filter((value): value is number => typeof value === "number")
      )
    );
    const sourceItems =
      sourceItemIds.length > 0
        ? await tx
            .select()
            .from(purchaseOrderItems)
            .where(inArray(purchaseOrderItems.id, sourceItemIds))
        : [];
    const sourceItemById = new Map(sourceItems.map(item => [item.id, item]));
    const catalogCodes = Array.from(
      new Set(
        items
          .flatMap(item => {
            const sourceItem = item.sourceItemId
              ? sourceItemById.get(item.sourceItemId)
              : null;
            return [
              sourceItem?.currentSapItemCode,
              sourceItem?.originalSapItemCode,
              item.sapItemCode,
            ];
          })
          .map(code => code?.trim())
          .filter((code): code is string => Boolean(code))
      )
    );
    const catalogRows =
      catalogCodes.length > 0
        ? await tx
            .select({
              itemCode: sapCatalog.itemCode,
              tipoArticulo: sapCatalog.tipoArticulo,
            })
            .from(sapCatalog)
            .where(inArray(sapCatalog.itemCode, catalogCodes))
        : [];
    const catalogByCode = new Map(
      catalogRows.map(catalog => [catalog.itemCode, catalog])
    );

    const now = new Date();

    for (const item of items) {
      const quantityReceived = parseDecimal(item.quantityReceived);
      if (quantityReceived <= 0) continue;

      const sourceItem = item.sourceItemId
        ? sourceItemById.get(item.sourceItemId)
        : null;
      const sapItemCode =
        sourceItem?.currentSapItemCode ??
        sourceItem?.originalSapItemCode ??
        item.sapItemCode ??
        null;
      const catalogItem =
        catalogByCode.get(sapItemCode?.trim() ?? "") ??
        catalogByCode.get(item.sapItemCode?.trim() ?? "");
      const tipoArticulo = Number(catalogItem?.tipoArticulo ?? 0);
      const isNonInventoryLine =
        tipoArticulo === 2 ||
        tipoArticulo === 3 ||
        Boolean(sourceItem?.fixedAssetArticleId) ||
        Boolean(item.fixedAssetSapItemCode) ||
        String(sapItemCode ?? "")
          .trim()
          .toUpperCase()
          .startsWith("AFT");

      if (!isNonInventoryLine) {
        await consumeInventoryStockWithClient(tx, {
          sapItemCode,
          itemName: item.itemName,
          projectId: row.receipt.projectId,
          warehouseId: item.warehouseId,
          quantity: item.quantityReceived,
        });
      }

      if (!sourceItem) continue;

      const nextOrderReceived = Math.max(
        parseDecimal(sourceItem.receivedQuantity) - quantityReceived,
        0
      );
      await tx
        .update(purchaseOrderItems)
        .set({
          receivedQuantity: toDecimalString(nextOrderReceived),
          updatedAt: now,
        })
        .where(eq(purchaseOrderItems.id, sourceItem.id));
      sourceItemById.set(sourceItem.id, {
        ...sourceItem,
        receivedQuantity: toDecimalString(nextOrderReceived),
      });

      if (sourceItem.purchaseRequestItemId) {
        const [purchaseRequestItem] = await tx
          .select()
          .from(purchaseRequestItems)
          .where(eq(purchaseRequestItems.id, sourceItem.purchaseRequestItemId))
          .limit(1);
        if (purchaseRequestItem) {
          const nextPurchaseRequestReceived = Math.max(
            parseDecimal(purchaseRequestItem.receivedQuantity) -
              quantityReceived,
            0
          );
          await tx
            .update(purchaseRequestItems)
            .set({
              receivedQuantity: toDecimalString(nextPurchaseRequestReceived),
              updatedAt: now,
            })
            .where(eq(purchaseRequestItems.id, purchaseRequestItem.id));
        }
      }

      if (sourceItem.materialRequestItemId) {
        const [requestItem] = await tx
          .select()
          .from(requestItems)
          .where(eq(requestItems.id, sourceItem.materialRequestItemId))
          .limit(1);
        if (requestItem) {
          const requestedQuantity = parseDecimal(requestItem.quantity);
          const nextDelivered = Math.max(
            parseDecimal(requestItem.deliveredQuantity) - quantityReceived,
            0
          );
          const nextStatus =
            nextDelivered <= 0
              ? "pendiente"
              : nextDelivered < requestedQuantity
                ? "parcial"
                : "completo";
          affectedRequestIds.add(requestItem.requestId);

          await tx
            .update(requestItems)
            .set({
              deliveredQuantity: toDecimalString(nextDelivered),
              status: nextStatus,
              updatedAt: now,
            })
            .where(eq(requestItems.id, requestItem.id));
        }
      }
    }

    const [replacementReceipt] = await tx
      .insert(receipts)
      .values({
        receiptNumber: replacementReceiptNumber,
        sourceType: row.receipt.sourceType,
        sourceId: row.receipt.sourceId,
        projectId: row.receipt.projectId,
        receivedById: params.correctedById,
        status: "borrador",
        isFiscalDocument: row.receipt.isFiscalDocument,
        cai: row.receipt.cai,
        invoiceNumber: row.receipt.invoiceNumber,
        documentRangeStart: row.receipt.documentRangeStart,
        documentRangeEnd: row.receipt.documentRangeEnd,
        documentDate: row.receipt.documentDate,
        documentDueDate: row.receipt.documentDueDate,
        postingDate: row.receipt.postingDate,
        receiptDate: row.receipt.receiptDate,
        notes: row.receipt.notes,
        correctsReceiptId: row.receipt.id,
        updatedAt: now,
      })
      .returning();

    if (items.length > 0) {
      await tx.insert(receiptItems).values(
        items.map(item => ({
          receiptId: replacementReceipt.id,
          sourceItemId: item.sourceItemId,
          sapItemCode: item.sapItemCode,
          warehouseId: item.warehouseId,
          itemName: item.itemName,
          quantityExpected: item.quantityExpected,
          quantityReceived: item.quantityReceived,
          unit: item.unit,
          unitPrice: item.unitPrice,
          taxCode: item.taxCode,
          additionalTaxCodes: item.additionalTaxCodes,
          taxBreakdown: item.taxBreakdown,
          subtotal: item.subtotal,
          taxAmount: item.taxAmount,
          total: item.total,
          targetType: item.targetType,
          subProjectId: item.subProjectId,
          fixedAssetSapItemCode: item.fixedAssetSapItemCode,
          fixedAssetName: item.fixedAssetName,
          isFixedAsset: item.isFixedAsset,
          isLeasing: item.isLeasing,
          assetDetails: item.assetDetails,
          notes: item.notes,
        }))
      );
    }

    if (otherCharges.length > 0) {
      await tx.insert(receiptOtherCharges).values(
        otherCharges.map(charge => ({
          receiptId: replacementReceipt.id,
          concept: charge.concept,
          amount: charge.amount,
        }))
      );
    }

    const [updatedReceipt] = await tx
      .update(receipts)
      .set({
        status: "anulada",
        voidedAt: now,
        voidedById: params.correctedById,
        voidReason: normalizedReason,
        replacementReceiptId: replacementReceipt.id,
        updatedAt: now,
      })
      .where(eq(receipts.id, row.receipt.id))
      .returning();

    const [updatedInvoice] = await tx
      .update(invoices)
      .set({
        status: "anulada",
        voidedAt: now,
        voidedById: params.correctedById,
        voidReason: normalizedReason,
        updatedAt: now,
      })
      .where(eq(invoices.id, row.invoice.id))
      .returning();

    return {
      invoice: updatedInvoice,
      receipt: updatedReceipt,
      replacementReceipt,
    };
  });

  await syncPurchaseOrderReceiptStatus(affectedPurchaseOrderId);
  for (const requestId of Array.from(affectedRequestIds)) {
    await syncMaterialRequestFulfillmentStatus(requestId, params.correctedById);
  }

  return result;
}

export async function replaceInvoiceRetentions(
  invoiceId: number,
  retentions: Array<{
    invoiceItemId?: number | null;
    retentionCatalogId: number;
    baseAmount?: string | number | null;
  }>,
  retentionReceiptNumber?: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return db.transaction(async tx => {
    const [invoiceRow] = await tx
      .select({
        invoice: invoices,
        supplier: suppliers,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!invoiceRow) {
      throw new Error("Factura no encontrada");
    }
    const invoice = invoiceRow.invoice;
    const hasRetentions = retentions.length > 0;
    const normalizedRetentionReceiptNumber =
      retentionReceiptNumber?.trim() ||
      invoice.retentionReceiptNumber?.trim() ||
      null;
    if (hasRetentions && !normalizedRetentionReceiptNumber) {
      throw new Error(
        "Ingrese el número de comprobante de retención antes de guardar retenciones"
      );
    }
    if (hasRetentions && invoiceRow.supplier?.allowsTaxWithholding === false) {
      throw new Error("El proveedor no permite retención de impuestos");
    }

    const items = await tx
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId));
    const itemsById = new Map(items.map(item => [item.id, item]));
    const withholdingBase = roundMoney(
      items
        .filter(item => item.allowsTaxWithholding !== false)
        .reduce((sum, item) => sum + parseDecimal(item.subtotal), 0)
    );

    if (hasRetentions && withholdingBase <= 0) {
      throw new Error(
        "La factura no tiene líneas habilitadas para retención de impuestos"
      );
    }

    const lineRetentionCounts = new Map<number, number>();
    const lineRetentionCatalogs = new Set<string>();
    for (const retention of retentions) {
      const invoiceItemId = retention.invoiceItemId ?? null;
      if (!invoiceItemId) continue;

      const currentCount = (lineRetentionCounts.get(invoiceItemId) ?? 0) + 1;
      lineRetentionCounts.set(invoiceItemId, currentCount);
      if (currentCount > 2) {
        throw new Error("Cada producto puede tener máximo dos retenciones");
      }

      const duplicateKey = `${invoiceItemId}:${retention.retentionCatalogId}`;
      if (lineRetentionCatalogs.has(duplicateKey)) {
        throw new Error(
          "No se puede repetir la misma retención en el mismo producto"
        );
      }
      lineRetentionCatalogs.add(duplicateKey);
    }

    const requestedRetentionIds = Array.from(
      new Set(retentions.map(retention => retention.retentionCatalogId))
    );
    const [catalogRows, existingRows] = await Promise.all([
      requestedRetentionIds.length > 0
        ? tx
            .select()
            .from(taxRetentions)
            .where(inArray(taxRetentions.id, requestedRetentionIds))
        : Promise.resolve([]),
      tx
        .select({
          retentionCatalogId: invoiceRetentions.retentionCatalogId,
        })
        .from(invoiceRetentions)
        .where(eq(invoiceRetentions.invoiceId, invoiceId)),
    ]);
    const catalogById = new Map(
      catalogRows.map(retention => [retention.id, retention])
    );
    const existingCatalogIds = new Set(
      existingRows
        .map(retention => retention.retentionCatalogId)
        .filter((value): value is number => typeof value === "number")
    );

    const normalizedRetentions = retentions.map(retention => {
      const invoiceItemId = retention.invoiceItemId ?? null;
      const invoiceItem = invoiceItemId
        ? itemsById.get(invoiceItemId)
        : undefined;
      if (invoiceItemId && !invoiceItem) {
        throw new Error("La línea de factura seleccionada no existe");
      }
      if (invoiceItem && invoiceItem.allowsTaxWithholding === false) {
        throw new Error(
          "La línea seleccionada no permite retención de impuestos"
        );
      }

      const catalogRetention = catalogById.get(retention.retentionCatalogId);
      if (
        !catalogRetention ||
        (!catalogRetention.isActive &&
          !existingCatalogIds.has(retention.retentionCatalogId))
      ) {
        throw new Error("La retención seleccionada no existe o está inactiva");
      }

      const allowedBase = invoiceItem
        ? roundMoney(parseDecimal(invoiceItem.subtotal))
        : withholdingBase;
      const baseAmount = parseDecimal(retention.baseAmount ?? allowedBase);
      if (baseAmount <= 0) {
        throw new Error("La base de retención debe ser mayor que cero");
      }
      if (baseAmount - allowedBase > 0.000001) {
        throw new Error(
          invoiceItem
            ? "La base de retención no puede exceder el subtotal de la línea"
            : "La base de retención no puede exceder la base imponible de la factura"
        );
      }
      const percentage = parseDecimal(catalogRetention.ratePercent);
      const amount = roundMoney((baseAmount * percentage) / 100);
      if (amount <= 0) {
        throw new Error("El monto de la retención debe ser mayor que cero");
      }

      return {
        invoiceId,
        invoiceItemId,
        retentionCatalogId: catalogRetention.id,
        retentionCode: catalogRetention.taxCode,
        retentionErpCode: catalogRetention.erpCode,
        retentionType: "percentage" as const,
        description: catalogRetention.description,
        baseAmount: toMoneyString4(baseAmount),
        percentage: toRateString(percentage),
        amount: toMoneyString4(amount),
      };
    });

    const retentionTotal = roundMoney(
      normalizedRetentions.reduce(
        (sum, retention) => sum + parseDecimal(retention.amount),
        0
      )
    );
    const total = parseDecimal(invoice.total);
    if (retentionTotal - total > 0.000001) {
      throw new Error("El total de retenciones no puede exceder la factura");
    }
    if (retentionTotal - withholdingBase > 0.000001) {
      throw new Error(
        "El total de retenciones no puede exceder la base imponible de la factura"
      );
    }

    await tx
      .delete(invoiceRetentions)
      .where(eq(invoiceRetentions.invoiceId, invoiceId));
    if (normalizedRetentions.length > 0) {
      await tx.insert(invoiceRetentions).values(normalizedRetentions);
    }

    const [updatedInvoice] = await tx
      .update(invoices)
      .set({
        retentionTotal: toMoneyString4(retentionTotal),
        netPayable: toMoneyString4(total - retentionTotal),
        retentionReceiptNumber: hasRetentions
          ? normalizedRetentionReceiptNumber
          : retentionReceiptNumber?.trim() || invoice.retentionReceiptNumber,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    return updatedInvoice;
  });
}

// ============================================================
// WAREHOUSE EXITS
// ============================================================
function buildWarehouseExitDocument(params: {
  exitNumber: string;
  projectLabel: string;
  warehouseLabel: string;
  exitDate: Date | string | null | undefined;
  printedAt?: Date | string | null | undefined;
  receivedByName?: string | null;
  notes?: string | null;
  items: Array<{
    sapItemCode: string;
    itemName: string;
    quantity: string | number;
    unit?: string | null;
    targetLabel?: string | null;
    notes?: string | null;
  }>;
}) {
  return buildProcurementPdfBase64({
    title: "Salida de Inventario",
    documentNumber: params.exitNumber,
    badgeText: "SB",
    primaryFields: [
      {
        label: "Proyecto",
        value: params.projectLabel,
      },
      {
        label: "Bodega",
        value: params.warehouseLabel,
      },
    ],
    secondaryFields: [
      {
        label: "Fecha salida",
        value: formatDateLabel(params.exitDate),
      },
      {
        label: "Generado",
        value: formatDateLabel(params.printedAt ?? new Date()),
      },
      {
        label: "Items",
        value: `${params.items.length} registrados`,
      },
      {
        label: "Recibido por",
        value: params.receivedByName?.trim() || "-",
      },
    ],
    items: params.items.map(item => ({
      description: item.itemName,
      quantityLabel: `${item.quantity} ${item.unit ?? ""}`.trim(),
      metaLines: [
        ...(item.sapItemCode ? [`SAP: ${item.sapItemCode}`] : []),
        ...(item.targetLabel ? [`Destino: ${item.targetLabel}`] : []),
        ...((item.notes ?? params.notes)
          ? [`Notas: ${item.notes ?? params.notes}`]
          : []),
      ],
    })),
    generatedLabel: formatDateLabel(params.printedAt ?? new Date()),
    footerNote: "Salida de bodega emitida automáticamente por BuildReq.",
    detailTitle: "Detalle de la salida",
    detailDescription: "Resumen de artículos despachados desde la bodega.",
  });
}

function buildWarehouseExitTargetLabel(item: {
  targetType?: "subproyecto" | "activo_fijo" | null;
  subProjectId?: number | null;
  subproject?: { code?: string | null; name?: string | null } | null;
  fixedAssetSapItemCode?: string | null;
  fixedAssetName?: string | null;
}) {
  if (item.targetType === "subproyecto") {
    if (item.subproject) {
      return `${item.subproject.code ?? ""} - ${item.subproject.name ?? ""}`.trim();
    }
    return item.subProjectId ? `Subproyecto #${item.subProjectId}` : null;
  }
  if (item.targetType === "activo_fijo") {
    const code = item.fixedAssetSapItemCode?.trim();
    const name = item.fixedAssetName?.trim();
    if (code && name) return `${code} - ${name}`;
    return code || name || null;
  }
  return null;
}

function buildWarehouseExitWarehouseLabel(params: {
  warehouse?: { displayName?: string | null; name?: string | null } | null;
  items?: Array<{
    warehouse?: { displayName?: string | null; name?: string | null } | null;
  }>;
}) {
  const directLabel =
    params.warehouse?.displayName?.trim() || params.warehouse?.name?.trim();
  if (directLabel) return directLabel;

  const itemLabels = Array.from(
    new Set(
      (params.items ?? [])
        .map(
          item =>
            item.warehouse?.displayName?.trim() || item.warehouse?.name?.trim()
        )
        .filter((label): label is string => Boolean(label))
    )
  );

  if (itemLabels.length === 1) return itemLabels[0];
  if (itemLabels.length > 1) return "Varios almacenes";
  return "Bodega del proyecto";
}

export async function listWarehouseExits(filters?: {
  projectId?: number;
  projectIds?: number[];
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.projectId) {
    conditions.push(eq(warehouseExits.projectId, filters.projectId));
  }
  if (filters?.projectIds) {
    applyProjectScope(conditions, warehouseExits.projectId, filters.projectIds);
  }
  if (filters?.status) {
    conditions.push(eq(warehouseExits.status, filters.status as any));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      warehouseExit: warehouseExits,
      project: projects,
      warehouse: warehouses,
      createdBy: users,
      itemCount: count(warehouseExitItems.id),
      totalQuantity: sql<string>`coalesce(sum(${warehouseExitItems.quantity}), 0)`,
    })
    .from(warehouseExits)
    .leftJoin(projects, eq(warehouseExits.projectId, projects.id))
    .leftJoin(warehouses, eq(warehouseExits.warehouseId, warehouses.id))
    .leftJoin(users, eq(warehouseExits.createdById, users.id))
    .leftJoin(
      warehouseExitItems,
      eq(warehouseExitItems.warehouseExitId, warehouseExits.id)
    )
    .where(where)
    .groupBy(
      warehouseExits.id,
      warehouseExits.exitNumber,
      warehouseExits.projectId,
      warehouseExits.warehouseId,
      warehouseExits.destinationProjectId,
      warehouseExits.destinationWarehouseId,
      warehouseExits.materialRequestId,
      warehouseExits.createdById,
      warehouseExits.emittedById,
      warehouseExits.cancelledById,
      warehouseExits.status,
      warehouseExits.exitDate,
      warehouseExits.emittedAt,
      warehouseExits.cancelledAt,
      warehouseExits.cancellationReason,
      warehouseExits.notes,
      warehouseExits.printedDocumentName,
      warehouseExits.printedDocumentMimeType,
      warehouseExits.printedDocumentContent,
      warehouseExits.printedAt,
      warehouseExits.createdAt,
      warehouseExits.updatedAt,
      projects.id,
      projects.code,
      projects.name,
      projects.description,
      projects.location,
      projects.status,
      projects.warehouseId,
      projects.sapProjectCode,
      projects.demoBatchKey,
      projects.createdAt,
      projects.updatedAt,
      warehouses.id,
      warehouses.code,
      warehouses.localCode,
      warehouses.name,
      warehouses.displayName,
      warehouses.description,
      warehouses.isDefault,
      warehouses.isCentralWarehouse,
      warehouses.isSharedWarehouse,
      warehouses.isActive,
      warehouses.createdAt,
      warehouses.updatedAt,
      users.id,
      users.openId,
      users.name,
      users.email,
      users.loginMethod,
      users.role,
      users.buildreqRole,
      users.assignedProjectId,
      users.createdAt,
      users.updatedAt,
      users.lastSignedIn
    )
    .orderBy(desc(warehouseExits.createdAt));

  return rows.map(
    ({
      warehouseExit,
      project,
      warehouse,
      createdBy,
      itemCount,
      totalQuantity,
    }) => ({
      warehouseExit,
      project,
      warehouse,
      createdBy: createdBy
        ? {
            id: createdBy.id,
            name: createdBy.name,
            email: createdBy.email,
          }
        : null,
      itemCount: Number(itemCount ?? 0),
      totalQuantity: toDecimalString(totalQuantity),
    })
  );
}

export async function getWarehouseExitById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const destinationProjects = alias(
    projects,
    "warehouse_exit_destination_projects"
  );
  const destinationWarehouses = alias(
    warehouses,
    "warehouse_exit_destination_warehouses"
  );
  const itemDestinationProjects = alias(
    projects,
    "warehouse_exit_item_destination_projects"
  );
  const itemDestinationWarehouses = alias(
    warehouses,
    "warehouse_exit_item_destination_warehouses"
  );
  const rows = await db
    .select({
      warehouseExit: warehouseExits,
      project: projects,
      warehouse: warehouses,
      destinationProject: destinationProjects,
      destinationWarehouse: destinationWarehouses,
      createdBy: users,
    })
    .from(warehouseExits)
    .leftJoin(projects, eq(warehouseExits.projectId, projects.id))
    .leftJoin(warehouses, eq(warehouseExits.warehouseId, warehouses.id))
    .leftJoin(
      destinationProjects,
      eq(warehouseExits.destinationProjectId, destinationProjects.id)
    )
    .leftJoin(
      destinationWarehouses,
      eq(warehouseExits.destinationWarehouseId, destinationWarehouses.id)
    )
    .leftJoin(users, eq(warehouseExits.createdById, users.id))
    .where(eq(warehouseExits.id, id))
    .limit(1);

  if (!rows[0]) return undefined;

  const itemRows = await db
    .select({
      item: warehouseExitItems,
      warehouse: warehouses,
      destinationProject: itemDestinationProjects,
      destinationWarehouse: itemDestinationWarehouses,
      subproject: projectSubprojects,
    })
    .from(warehouseExitItems)
    .leftJoin(warehouses, eq(warehouseExitItems.warehouseId, warehouses.id))
    .leftJoin(
      itemDestinationProjects,
      eq(warehouseExitItems.destinationProjectId, itemDestinationProjects.id)
    )
    .leftJoin(
      itemDestinationWarehouses,
      eq(
        warehouseExitItems.destinationWarehouseId,
        itemDestinationWarehouses.id
      )
    )
    .leftJoin(
      projectSubprojects,
      eq(warehouseExitItems.subProjectId, projectSubprojects.id)
    )
    .where(eq(warehouseExitItems.warehouseExitId, id))
    .orderBy(asc(warehouseExitItems.id));
  const items = itemRows.map(
    ({ item, warehouse, destinationProject, destinationWarehouse, subproject }) => ({
    ...item,
    warehouse: warehouse ? mapWarehouseSummary(warehouse) : null,
    destinationProject: destinationProject
      ? {
          id: destinationProject.id,
          code: destinationProject.code,
          name: destinationProject.name,
        }
      : null,
    destinationWarehouse: destinationWarehouse
      ? mapWarehouseSummary(destinationWarehouse)
      : null,
    subproject: subproject
      ? {
          id: subproject.id,
          code: subproject.code,
          name: subproject.name,
          description: subproject.description,
        }
      : null,
  }));

  const returnedQuantityByExitItemId = new Map<number, number>();
  const warehouseExitItemIds = items.map(item => item.id);
  if (warehouseExitItemIds.length > 0) {
    const returnedRows = await db
      .select({
        sourceWarehouseExitItemId:
          reverseLogisticsItems.sourceWarehouseExitItemId,
        quantity: reverseLogisticsItems.quantity,
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
            warehouseExitItemIds
          ),
          sql`${reverseLogistics.status} <> 'rechazada'`
        )
      );

    for (const row of returnedRows) {
      if (!row.sourceWarehouseExitItemId) continue;
      returnedQuantityByExitItemId.set(
        row.sourceWarehouseExitItemId,
        (returnedQuantityByExitItemId.get(row.sourceWarehouseExitItemId) ?? 0) +
          parseDecimal(row.quantity)
      );
    }
  }

  const enrichedItems = await Promise.all(
    items.map(async item => {
      const stockRows = await listInventoryRowsForStock({
        sapItemCode: item.sapItemCode,
        itemName: item.itemName,
        projectId: rows[0].warehouseExit.projectId,
        warehouseId: item.warehouseId ?? rows[0].warehouseExit.warehouseId,
      });
      const availableQuantity = stockRows.reduce(
        (sum, row) => sum + parseDecimal(row.currentStock),
        0
      );
      const exitQuantity = parseDecimal(item.quantity);
      const returnedQuantity = returnedQuantityByExitItemId.get(item.id) ?? 0;
      const stockAfterExit =
        rows[0].warehouseExit.status === "emitida"
          ? availableQuantity
          : availableQuantity - exitQuantity;

      return {
        ...item,
        availableQuantity: toDecimalString(availableQuantity),
        stockAfterExit: toDecimalString(stockAfterExit),
        returnedQuantity: toDecimalString(returnedQuantity),
        returnableQuantity: toDecimalString(
          Math.max(exitQuantity - returnedQuantity, 0)
        ),
      };
    })
  );

  let materialRequestSummary: {
    id: number;
    requestNumber: string;
    requestedById: number | null;
  } | null = null;
  let requestedBySummary: {
    id: number;
    name: string | null;
    email: string | null;
  } | null = null;

  if (rows[0].warehouseExit.materialRequestId) {
    const [requestRow] = await db
      .select({
        request: materialRequests,
        requestedBy: users,
      })
      .from(materialRequests)
      .leftJoin(users, eq(materialRequests.requestedById, users.id))
      .where(eq(materialRequests.id, rows[0].warehouseExit.materialRequestId))
      .limit(1);

    if (requestRow?.request) {
      materialRequestSummary = {
        id: requestRow.request.id,
        requestNumber: requestRow.request.requestNumber,
        requestedById: requestRow.request.requestedById,
      };
    }
    if (requestRow?.requestedBy) {
      requestedBySummary = {
        id: requestRow.requestedBy.id,
        name: requestRow.requestedBy.name,
        email: requestRow.requestedBy.email,
      };
    }
  }

  const warehouseExit =
    rows[0].warehouseExit.status === "emitida"
      ? {
          ...rows[0].warehouseExit,
          printedDocumentName: `${rows[0].warehouseExit.exitNumber}.pdf`,
          printedDocumentMimeType: "application/pdf",
          printedDocumentContent: buildWarehouseExitDocument({
            exitNumber: rows[0].warehouseExit.exitNumber,
            projectLabel: rows[0].project
              ? `${rows[0].project.code} - ${rows[0].project.name}`
              : `Proyecto ${rows[0].warehouseExit.projectId}`,
            warehouseLabel: buildWarehouseExitWarehouseLabel({
              warehouse: rows[0].warehouse,
              items: enrichedItems,
            }),
            exitDate: rows[0].warehouseExit.exitDate,
            receivedByName: rows[0].warehouseExit.receivedByName,
            printedAt:
              rows[0].warehouseExit.printedAt ??
              rows[0].warehouseExit.emittedAt ??
              new Date(),
            notes: rows[0].warehouseExit.notes,
            items: enrichedItems.map(item => ({
              sapItemCode: item.sapItemCode,
              itemName: item.itemName,
              quantity: item.quantity,
              unit: item.unit,
              targetLabel: [
                item.destinationProject || item.destinationWarehouse
                  ? [
                      item.destinationProject
                        ? `${item.destinationProject.code} - ${item.destinationProject.name}`
                        : item.destinationProjectId
                          ? `Proyecto ${item.destinationProjectId}`
                          : null,
                      item.destinationWarehouse?.displayName ||
                        item.destinationWarehouse?.name ||
                        (item.destinationWarehouseId
                          ? `Almacén ${item.destinationWarehouseId}`
                          : null),
                    ]
                      .filter(Boolean)
                      .join(" / ")
                  : null,
                buildWarehouseExitTargetLabel(item),
              ]
                .filter(Boolean)
                .join(" | "),
              notes: item.notes,
            })),
          }),
        }
      : rows[0].warehouseExit;

  return {
    ...rows[0],
    warehouseExit,
    createdBy: rows[0].createdBy
      ? {
          id: rows[0].createdBy.id,
          name: rows[0].createdBy.name,
          email: rows[0].createdBy.email,
        }
      : null,
    materialRequest: materialRequestSummary,
    requestedBy: requestedBySummary,
    items: enrichedItems,
  };
}

async function resolveWarehouseExitItemTarget(params: {
  projectId: number;
  itemName: string;
  targetType?: "subproyecto" | "activo_fijo" | null;
  subProjectId?: number | null;
  fixedAssetSapItemCode?: string | null;
  fixedAssetName?: string | null;
}) {
  if (!params.targetType) {
    return {
      targetType: null,
      subProjectId: null,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  if (params.targetType === "subproyecto") {
    if (!params.subProjectId) {
      throw new Error(
        `Seleccione un subproyecto válido para ${params.itemName}`
      );
    }

    const subproject = await getProjectSubprojectById(params.subProjectId);
    if (
      !subproject ||
      subproject.projectId !== params.projectId ||
      subproject.isActive === false
    ) {
      throw new Error(
        `El subproyecto de ${params.itemName} no pertenece al proyecto o está inactivo`
      );
    }

    return {
      targetType: "subproyecto" as const,
      subProjectId: subproject.id,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  const fixedAssetSapItemCode = params.fixedAssetSapItemCode?.trim();
  if (!fixedAssetSapItemCode) {
    throw new Error(`Seleccione un activo fijo válido para ${params.itemName}`);
  }

  const fixedAsset = await getActiveFixedAssetByCode(
    fixedAssetSapItemCode,
    params.projectId
  );
  if (!fixedAsset) {
    throw new Error(
      `El activo fijo de ${params.itemName} no existe, está inactivo o no pertenece al proyecto`
    );
  }

  return {
    targetType: "activo_fijo" as const,
    subProjectId: null,
    fixedAssetSapItemCode: fixedAsset.itemCode,
    fixedAssetName: params.fixedAssetName?.trim() || fixedAsset.description,
  };
}

export async function createWarehouseExit(
  data: Omit<
    InsertWarehouseExit,
    | "exitNumber"
    | "warehouseId"
    | "emittedAt"
    | "emittedById"
    | "cancelledAt"
    | "cancelledById"
    | "cancellationReason"
    | "printedDocumentName"
    | "printedDocumentMimeType"
    | "printedDocumentContent"
    | "printedAt"
  >,
  items: Omit<InsertWarehouseExitItem, "warehouseExitId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (items.length === 0) {
    throw new Error("Debe registrar al menos un ítem");
  }

  const project = await getProjectById(data.projectId);
  if (!project) {
    throw new Error("El proyecto seleccionado no existe");
  }
  const hasDestinationScope =
    data.destinationProjectId != null || data.destinationWarehouseId != null;
  const destinationAssignment = hasDestinationScope
    ? await resolveProjectAssignment(
        data.destinationProjectId ?? null,
        data.destinationWarehouseId ?? null
      )
    : null;
  if (hasDestinationScope && !destinationAssignment) {
    throw new Error("Seleccione almacén destino y proyecto/bodega destino");
  }

  const exitNumber = await generateWarehouseExitNumber(data.projectId);
  const normalizedItems = await Promise.all(
    items.map(async item => {
      const sapItemCode = item.sapItemCode?.trim();
      if (!sapItemCode) {
        throw new Error("Todos los ítems deben tener código SAP");
      }
      const quantity = parseDecimal(item.quantity);
      if (quantity <= 0) {
        throw new Error("Todas las cantidades deben ser mayores que cero");
      }

      const assignment = await resolveProjectAssignment(
        project.id,
        item.warehouseId
      );
      if (!assignment) {
        throw new Error("Debe seleccionar almacén para todos los ítems");
      }
      const hasItemDestinationScope =
        item.destinationProjectId != null || item.destinationWarehouseId != null;
      const itemDestinationAssignment = hasItemDestinationScope
        ? await resolveProjectAssignment(
            item.destinationProjectId ?? null,
            item.destinationWarehouseId ?? null
          )
        : null;
      if (hasItemDestinationScope && !itemDestinationAssignment) {
        throw new Error(
          `Seleccione almacén destino y bodega/proyecto destino para ${item.itemName}`
        );
      }
      const target = await resolveWarehouseExitItemTarget({
        projectId: project.id,
        itemName: item.itemName,
        targetType: item.targetType,
        subProjectId: item.subProjectId,
        fixedAssetSapItemCode: item.fixedAssetSapItemCode,
        fixedAssetName: item.fixedAssetName,
      });

      return {
        warehouseId: assignment.warehouseId,
        destinationProjectId: itemDestinationAssignment?.projectId ?? null,
        destinationWarehouseId: itemDestinationAssignment?.warehouseId ?? null,
        materialRequestItemId: item.materialRequestItemId ?? null,
        sapItemCode,
        itemName: item.itemName.trim(),
        quantity: toDecimalString(quantity),
        unit: item.unit?.trim() || null,
        ...target,
        notes: item.notes?.trim() || null,
      };
    })
  );
  const itemWarehouseIds = Array.from(
    new Set(normalizedItems.map(item => item.warehouseId))
  );
  const headerWarehouseId =
    itemWarehouseIds.length === 1 ? itemWarehouseIds[0] : null;
  const itemDestinationProjectIds = Array.from(
    new Set(
      normalizedItems
        .map(item => item.destinationProjectId)
        .filter((projectId): projectId is number => projectId != null)
    )
  );
  const itemDestinationWarehouseIds = Array.from(
    new Set(
      normalizedItems
        .map(item => item.destinationWarehouseId)
        .filter((warehouseId): warehouseId is number => warehouseId != null)
    )
  );
  const headerDestinationProjectId =
    itemDestinationProjectIds.length === 1
      ? itemDestinationProjectIds[0]
      : destinationAssignment?.projectId ?? null;
  const headerDestinationWarehouseId =
    itemDestinationWarehouseIds.length === 1
      ? itemDestinationWarehouseIds[0]
      : destinationAssignment?.warehouseId ?? null;
  const [created] = await db
    .insert(warehouseExits)
    .values({
      ...data,
      exitNumber,
      warehouseId: headerWarehouseId,
      destinationProjectId: headerDestinationProjectId,
      destinationWarehouseId: headerDestinationWarehouseId,
      status: data.status ?? "borrador",
      exitDate: data.exitDate ?? new Date(),
    })
    .returning({ id: warehouseExits.id });

  await db.insert(warehouseExitItems).values(
    normalizedItems.map(item => ({
      ...item,
      warehouseExitId: created.id,
    }))
  );

  return {
    id: created.id,
    exitNumber,
    warehouseId: headerWarehouseId,
  };
}

async function applyWarehouseExitToRequestItem(params: {
  exitNumber: string;
  requestItemId: number;
  quantity: string | number;
  note?: string | null;
  processedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  if (!item) {
    throw new Error("Ítem de requisición no encontrado");
  }

  const requested = parseDecimal(item.quantity);
  const alreadyDispatched = parseDecimal(item.dispatchedQuantity);
  const dispatchedIncrement = parseDecimal(params.quantity);
  const pendingForExit = getWarehouseExitPendingQuantityForRequestItem(item);
  const nextDispatched = alreadyDispatched + dispatchedIncrement;
  const nextDelivered = Math.max(
    parseDecimal(item.deliveredQuantity),
    nextDispatched
  );
  const nextFulfilled = Math.max(nextDelivered, nextDispatched);
  const nextStatus =
    nextFulfilled <= 0
      ? "pendiente"
      : nextFulfilled < requested
        ? "parcial"
        : "completo";

  if (dispatchedIncrement <= 0) {
    throw new Error("La cantidad despachada debe ser mayor que cero");
  }

  if (dispatchedIncrement - pendingForExit > 0.000001) {
    throw new Error(
      "La cantidad despachada no puede exceder la cantidad recibida disponible para salida"
    );
  }

  await db
    .update(requestItems)
    .set({
      dispatchedQuantity: toDecimalString(nextDispatched),
      deliveredQuantity: toDecimalString(nextDelivered),
      warehouseExitNote: params.note ?? null,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(requestItems.id, params.requestItemId));

  const [existingFlow] = await db
    .select()
    .from(supplyFlowRecords)
    .where(
      and(
        eq(supplyFlowRecords.requestId, item.requestId),
        eq(supplyFlowRecords.requestItemId, params.requestItemId),
        eq(supplyFlowRecords.flowType, "despacho_bodega"),
        eq(supplyFlowRecords.sapDocumentNumber, params.exitNumber)
      )
    )
    .limit(1);

  if (existingFlow) {
    await db
      .update(supplyFlowRecords)
      .set({
        notes: params.note ?? existingFlow.notes,
        sapDocumentNumber: params.exitNumber,
        status: nextDispatched < requested ? "en_proceso" : "completado",
        updatedAt: new Date(),
      })
      .where(eq(supplyFlowRecords.id, existingFlow.id));
  } else {
    await db.insert(supplyFlowRecords).values({
      requestId: item.requestId,
      requestItemId: params.requestItemId,
      flowType: "despacho_bodega",
      sourceWarehouse: "Bodega del Proyecto",
      sapDocumentType: "salida_inventario",
      sapDocumentNumber: params.exitNumber,
      processedById: params.processedById,
      notes: params.note ?? null,
      status: nextDispatched < requested ? "en_proceso" : "completado",
    });
  }

  return { status: nextStatus, requestId: item.requestId };
}

export async function updateWarehouseExitDraft(
  id: number,
  params: {
    receivedByName: string;
    notes?: string | null;
    items: Array<{
      id: number;
      quantity: string | number;
      notes?: string | null;
    }>;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const detail = await getWarehouseExitById(id);
  if (!detail) {
    throw new Error("Salida de bodega no encontrada");
  }
  if (detail.warehouseExit.status !== "borrador") {
    throw new Error("Solo se pueden editar salidas en borrador");
  }
  if (!params.receivedByName.trim()) {
    throw new Error("Ingrese a quién se le entrega la salida");
  }
  if (params.items.length === 0) {
    throw new Error("Debe registrar al menos un ítem");
  }

  const inputByItemId = new Map(params.items.map(item => [item.id, item]));
  if (inputByItemId.size !== params.items.length) {
    throw new Error("No se puede repetir un ítem en la edición");
  }

  const detailItemIds = new Set(detail.items.map(item => item.id));
  const includesAllItems =
    inputByItemId.size === detailItemIds.size &&
    Array.from(inputByItemId.keys()).every(itemId => detailItemIds.has(itemId));
  if (!includesAllItems) {
    throw new Error("La edición debe incluir todos los ítems del borrador");
  }

  const requestItemIds = Array.from(
    new Set(
      detail.items
        .map(item => item.materialRequestItemId)
        .filter((itemId): itemId is number => typeof itemId === "number")
    )
  );
  const requestItemRows =
    requestItemIds.length > 0
      ? await db
          .select()
          .from(requestItems)
          .where(inArray(requestItems.id, requestItemIds))
      : [];
  const requestItemById = new Map(requestItemRows.map(item => [item.id, item]));

  const requestedByStockKey = new Map<
    string,
    {
      sapItemCode: string | null;
      itemName: string;
      warehouseId: number;
      quantity: number;
    }
  >();
  const normalizedItems = detail.items.map(item => {
    const input = inputByItemId.get(item.id)!;
    const quantity = parseDecimal(input.quantity);
    const returnedQuantity = parseDecimal(item.returnedQuantity);
    if (quantity <= 0) {
      throw new Error(
        `La cantidad de ${item.itemName} debe ser mayor que cero`
      );
    }
    if (returnedQuantity - quantity > 0.000001) {
      throw new Error(
        `La cantidad de ${item.itemName} no puede ser menor a lo ya devuelto`
      );
    }

    if (item.materialRequestItemId) {
      const requestItem = requestItemById.get(item.materialRequestItemId);
      if (!requestItem) {
        throw new Error(
          `Ítem de requisición no encontrado para ${item.itemName}`
        );
      }
      const pendingQuantity =
        getWarehouseExitPendingQuantityForRequestItem(requestItem);
      if (quantity - pendingQuantity > 0.000001) {
        throw new Error(
          `La cantidad de ${item.itemName} no puede exceder la cantidad pendiente para salida`
        );
      }
    }

    const warehouseId = item.warehouseId ?? detail.warehouseExit.warehouseId;
    if (!warehouseId) {
      throw new Error(`El ítem ${item.itemName} no tiene bodega asignada`);
    }

    const sapItemCode = item.sapItemCode?.trim() || null;
    const stockKey = `${sapItemCode || item.itemName.trim().toLowerCase()}::${warehouseId}`;
    const current = requestedByStockKey.get(stockKey) ?? {
      sapItemCode,
      itemName: item.itemName,
      warehouseId,
      quantity: 0,
    };
    current.quantity += quantity;
    requestedByStockKey.set(stockKey, current);

    return {
      id: item.id,
      quantity: toDecimalString(quantity),
      notes: input.notes?.trim() || null,
    };
  });

  for (const requested of Array.from(requestedByStockKey.values())) {
    const availableQuantity = parseDecimal(
      await getStockByItem({
        sapItemCode: requested.sapItemCode,
        itemName: requested.itemName,
        projectId: detail.warehouseExit.projectId,
        warehouseId: requested.warehouseId,
      })
    );
    if (requested.quantity - availableQuantity > 0.000001) {
      throw new Error(
        `Stock insuficiente para ${requested.itemName}. Disponible: ${toDecimalString(
          availableQuantity
        )}, solicitado para salida: ${toDecimalString(requested.quantity)}.`
      );
    }
  }

  const normalizedNotes = params.notes?.trim() || null;
  const normalizedReceivedByName = params.receivedByName.trim();
  await db.transaction(async tx => {
    await tx
      .update(warehouseExits)
      .set({
        receivedByName: normalizedReceivedByName,
        notes: normalizedNotes,
        updatedAt: new Date(),
      })
      .where(eq(warehouseExits.id, id));

    for (const item of normalizedItems) {
      await tx
        .update(warehouseExitItems)
        .set({
          quantity: item.quantity,
          notes: item.notes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(warehouseExitItems.id, item.id),
            eq(warehouseExitItems.warehouseExitId, id)
          )
        );
    }

    await tx
      .update(supplyFlowRecords)
      .set({
        notes: normalizedNotes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(
            supplyFlowRecords.sapDocumentNumber,
            detail.warehouseExit.exitNumber
          ),
          eq(supplyFlowRecords.flowType, "despacho_bodega"),
          eq(supplyFlowRecords.status, "pendiente")
        )
      );
  });

  return getWarehouseExitById(id);
}

export async function emitWarehouseExit(id: number, emittedById: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const detail = await getWarehouseExitById(id);
  if (!detail) {
    throw new Error("Salida de bodega no encontrada");
  }
  if (detail.warehouseExit.status !== "borrador") {
    throw new Error("Solo se pueden emitir salidas en borrador");
  }
  if (!detail.items.length) {
    throw new Error("La salida de bodega no tiene ítems");
  }

  const affectedRequestIds = new Set<number>();
  for (const item of detail.items) {
    await consumeInventoryStock({
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      projectId: detail.warehouseExit.projectId,
      warehouseId: item.warehouseId ?? detail.warehouseExit.warehouseId,
      quantity: item.quantity,
    });

    if (item.materialRequestItemId) {
      const result = await applyWarehouseExitToRequestItem({
        exitNumber: detail.warehouseExit.exitNumber,
        requestItemId: item.materialRequestItemId,
        quantity: item.quantity,
        note: item.notes ?? detail.warehouseExit.notes,
        processedById: emittedById,
      });
      affectedRequestIds.add(result.requestId);
    }
  }

  const printedAt = new Date();
  const printedDocumentContent = buildWarehouseExitDocument({
    exitNumber: detail.warehouseExit.exitNumber,
    projectLabel: detail.project
      ? `${detail.project.code} - ${detail.project.name}`
      : `Proyecto ${detail.warehouseExit.projectId}`,
    warehouseLabel: buildWarehouseExitWarehouseLabel({
      warehouse: detail.warehouse,
      items: detail.items,
    }),
    exitDate: detail.warehouseExit.exitDate,
    receivedByName: detail.warehouseExit.receivedByName,
    printedAt,
    notes: detail.warehouseExit.notes,
    items: detail.items.map(item => ({
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      targetLabel: buildWarehouseExitTargetLabel(item),
      notes: item.notes,
    })),
  });

  await db
    .update(warehouseExits)
    .set({
      status: "emitida",
      emittedById,
      emittedAt: printedAt,
      printedDocumentName: `${detail.warehouseExit.exitNumber}.pdf`,
      printedDocumentMimeType: "application/pdf",
      printedDocumentContent,
      printedAt,
      updatedAt: new Date(),
    })
    .where(eq(warehouseExits.id, id));

  return {
    success: true,
    exitNumber: detail.warehouseExit.exitNumber,
    materialRequestIds: Array.from(affectedRequestIds),
  };
}

export async function cancelWarehouseExitDraft(
  id: number,
  cancelledById: number,
  reason?: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const detail = await getWarehouseExitById(id);
  if (!detail) {
    throw new Error("Salida de bodega no encontrada");
  }
  if (detail.warehouseExit.status !== "borrador") {
    throw new Error("Solo se pueden anular borradores de salida");
  }

  await db
    .update(warehouseExits)
    .set({
      status: "anulada",
      cancelledById,
      cancelledAt: new Date(),
      cancellationReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(warehouseExits.id, id));

  await db
    .update(supplyFlowRecords)
    .set({
      status: "cancelado",
      notes: reason ?? detail.warehouseExit.notes,
      updatedAt: new Date(),
    })
    .where(
      eq(supplyFlowRecords.sapDocumentNumber, detail.warehouseExit.exitNumber)
    );

  return { success: true };
}

// ============================================================
// OPENING BALANCES
// ============================================================
export async function listOpeningBalances(filters?: {
  projectId?: number;
  projectIds?: number[];
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.projectId) {
    conditions.push(eq(openingBalances.projectId, filters.projectId));
  }
  if (filters?.projectIds) {
    applyProjectScope(
      conditions,
      openingBalances.projectId,
      filters.projectIds
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      openingBalance: openingBalances,
      project: projects,
      warehouse: warehouses,
      createdBy: users,
      itemCount: count(openingBalanceItems.id),
      totalQuantity: sql<string>`coalesce(sum(${openingBalanceItems.quantity}), 0)`,
    })
    .from(openingBalances)
    .leftJoin(projects, eq(openingBalances.projectId, projects.id))
    .leftJoin(warehouses, eq(openingBalances.warehouseId, warehouses.id))
    .leftJoin(users, eq(openingBalances.createdById, users.id))
    .leftJoin(
      openingBalanceItems,
      eq(openingBalanceItems.openingBalanceId, openingBalances.id)
    )
    .where(where)
    .groupBy(
      openingBalances.id,
      openingBalances.balanceNumber,
      openingBalances.projectId,
      openingBalances.warehouseId,
      openingBalances.createdById,
      openingBalances.openingDate,
      openingBalances.notes,
      openingBalances.createdAt,
      openingBalances.updatedAt,
      projects.id,
      projects.code,
      projects.name,
      projects.description,
      projects.location,
      projects.status,
      projects.warehouseId,
      projects.sapProjectCode,
      projects.demoBatchKey,
      projects.createdAt,
      projects.updatedAt,
      warehouses.id,
      warehouses.code,
      warehouses.localCode,
      warehouses.name,
      warehouses.displayName,
      warehouses.description,
      warehouses.isDefault,
      warehouses.isCentralWarehouse,
      warehouses.isSharedWarehouse,
      warehouses.isActive,
      warehouses.createdAt,
      warehouses.updatedAt,
      users.id,
      users.openId,
      users.name,
      users.email,
      users.loginMethod,
      users.role,
      users.buildreqRole,
      users.assignedProjectId,
      users.createdAt,
      users.updatedAt,
      users.lastSignedIn
    )
    .orderBy(desc(openingBalances.createdAt));

  return rows.map(
    ({
      openingBalance,
      project,
      warehouse,
      createdBy,
      itemCount,
      totalQuantity,
    }) => ({
      openingBalance,
      project,
      warehouse,
      createdBy: createdBy
        ? {
            id: createdBy.id,
            name: createdBy.name,
            email: createdBy.email,
          }
        : null,
      itemCount: Number(itemCount ?? 0),
      totalQuantity: toDecimalString(totalQuantity),
    })
  );
}

export async function getOpeningBalanceById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      openingBalance: openingBalances,
      project: projects,
      warehouse: warehouses,
      createdBy: users,
    })
    .from(openingBalances)
    .leftJoin(projects, eq(openingBalances.projectId, projects.id))
    .leftJoin(warehouses, eq(openingBalances.warehouseId, warehouses.id))
    .leftJoin(users, eq(openingBalances.createdById, users.id))
    .where(eq(openingBalances.id, id))
    .limit(1);

  if (!rows[0]) return undefined;

  const items = await db
    .select()
    .from(openingBalanceItems)
    .where(eq(openingBalanceItems.openingBalanceId, id))
    .orderBy(asc(openingBalanceItems.id));

  return {
    ...rows[0],
    createdBy: rows[0].createdBy
      ? {
          id: rows[0].createdBy.id,
          name: rows[0].createdBy.name,
          email: rows[0].createdBy.email,
        }
      : null,
    items,
  };
}

async function getOpeningBalanceProjectForWarehouse(warehouseId: number) {
  const db = await getDb();
  if (!db) return null;

  const assignmentRows = await db
    .select({
      project: projects,
      isPrimary: projectWarehouseAssignments.isPrimary,
    })
    .from(projectWarehouseAssignments)
    .innerJoin(projects, eq(projectWarehouseAssignments.projectId, projects.id))
    .where(
      and(
        eq(projectWarehouseAssignments.warehouseId, warehouseId),
        eq(projects.status, "activo" as any)
      )
    )
    .orderBy(
      desc(projectWarehouseAssignments.isPrimary),
      asc(projects.code),
      asc(projects.name)
    )
    .limit(1);

  if (assignmentRows[0]?.project) return assignmentRows[0].project;

  const legacyRows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.warehouseId, warehouseId),
        eq(projects.status, "activo" as any)
      )
    )
    .orderBy(asc(projects.code), asc(projects.name))
    .limit(1);

  return legacyRows[0] ?? null;
}

export async function createOpeningBalance(
  data: Omit<InsertOpeningBalance, "balanceNumber" | "projectId"> & {
    projectId?: number | null;
  },
  items: Omit<InsertOpeningBalanceItem, "openingBalanceId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (items.length === 0) {
    throw new Error("Debe registrar al menos un ítem");
  }

  const project = data.projectId
    ? await getProjectById(data.projectId)
    : await getOpeningBalanceProjectForWarehouse(data.warehouseId);
  if (!project) {
    throw new Error(
      data.projectId
        ? "El proyecto seleccionado no existe"
        : "El almacén seleccionado no tiene proyecto activo asignado"
    );
  }

  const assignment = await resolveProjectAssignment(
    project.id,
    data.warehouseId
  );
  if (!assignment) {
    throw new Error("Debe seleccionar un almacén del proyecto");
  }
  const warehouse = assignment.warehouse;
  const existingBalance = await db
    .select()
    .from(openingBalances)
    .where(eq(openingBalances.warehouseId, warehouse.id))
    .limit(1);

  if (existingBalance[0]) {
    throw new Error(
      `La bodega ${warehouse.displayName} ya tiene un saldo inicial registrado.`
    );
  }

  const balanceNumber = await generateOpeningBalanceNumber(project.id);
  const [created] = await db
    .insert(openingBalances)
    .values({
      ...data,
      projectId: project.id,
      balanceNumber,
      warehouseId: warehouse.id,
      openingDate: data.openingDate ?? new Date(),
    })
    .returning({ id: openingBalances.id });

  const normalizedItems = items.map(item => ({
    openingBalanceId: created.id,
    sapItemCode: item.sapItemCode.trim(),
    itemName: item.itemName.trim(),
    quantity: toDecimalString(item.quantity),
    unit: item.unit?.trim() || null,
    notes: item.notes?.trim() || null,
  }));

  await db.insert(openingBalanceItems).values(normalizedItems);

  for (const item of normalizedItems) {
    await addInventoryStock({
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      unit: item.unit,
      projectId: project.id,
      quantity: item.quantity,
      warehouseId: warehouse.id,
      warehouseLocation: warehouse.displayName,
    });
  }

  return {
    id: created.id,
    balanceNumber,
    warehouseId: warehouse.id,
  };
}

export async function addOpeningBalanceItems(
  openingBalanceId: number,
  items: Omit<InsertOpeningBalanceItem, "openingBalanceId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (items.length === 0) {
    throw new Error("Debe agregar al menos un ítem");
  }

  const detail = await getOpeningBalanceById(openingBalanceId);
  if (!detail) {
    throw new Error("Saldo inicial no encontrado");
  }
  if (!detail.project) {
    throw new Error("El saldo inicial no tiene proyecto asociado");
  }

  const warehouse = detail.warehouse;
  if (!warehouse) {
    throw new Error("El saldo inicial no tiene bodega asignada");
  }

  const normalizedItems = items.map(item => {
    const quantity = parseDecimal(item.quantity);
    if (quantity <= 0) {
      throw new Error("Todas las cantidades deben ser mayores que cero");
    }

    return {
      openingBalanceId,
      sapItemCode: item.sapItemCode.trim(),
      itemName: item.itemName.trim(),
      quantity: toDecimalString(quantity),
      unit: item.unit?.trim() || null,
      notes: item.notes?.trim() || null,
    };
  });

  await db.insert(openingBalanceItems).values(normalizedItems);

  for (const item of normalizedItems) {
    await addInventoryStock({
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      unit: item.unit,
      projectId: detail.project.id,
      quantity: item.quantity,
      warehouseId: warehouse.id,
      warehouseLocation: warehouse.displayName,
    });
  }

  await db
    .update(openingBalances)
    .set({ updatedAt: new Date() })
    .where(eq(openingBalances.id, openingBalanceId));

  return {
    success: true,
    addedItems: normalizedItems.length,
  };
}

// ============================================================
// REVERSE LOGISTICS
// ============================================================
export async function generateReturnNumber(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return generateProjectScopedDocumentNumber({
    prefix: "DEV",
    projectId,
    selectExistingNumbers: async documentPrefix => {
      const rows = await db
        .select({ documentNumber: reverseLogistics.returnNumber })
        .from(reverseLogistics)
        .where(ilike(reverseLogistics.returnNumber, `${documentPrefix}%`));
      return rows.map(row => row.documentNumber);
    },
  });
}

function reverseLogisticReasonReopensRequest(reasonCategory: string) {
  return reasonCategory !== "excedente";
}

async function reopenMaterialRequestForWarehouseDispatch(
  requestId: number,
  processedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(materialRequests)
    .set({
      status: "en_proceso",
      workflowStage: "bodega_proyecto",
      closedAt: null,
      processedById,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(materialRequests.id, requestId));
}

async function reopenRequestItemAfterWarehouseReturn(params: {
  requestItemId: number;
  quantity: string | number;
  processedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  if (!item) return null;

  const returnedQuantity = parseDecimal(params.quantity);
  if (returnedQuantity <= 0) return item.requestId;

  const requested = parseDecimal(item.quantity);
  const nextDispatched = Math.max(
    parseDecimal(item.dispatchedQuantity) - returnedQuantity,
    0
  );
  const nextDelivered = Math.max(
    parseDecimal(item.deliveredQuantity) - returnedQuantity,
    0
  );
  const nextFulfilled = Math.max(nextDispatched, nextDelivered);
  const nextStatus =
    nextFulfilled <= 0
      ? "pendiente"
      : nextFulfilled < requested
        ? "parcial"
        : "completo";

  await db
    .update(requestItems)
    .set({
      dispatchedQuantity: toDecimalString(nextDispatched),
      deliveredQuantity: toDecimalString(nextDelivered),
      status: nextStatus,
      assignedFlow: "despacho_bodega",
      updatedAt: new Date(),
    })
    .where(eq(requestItems.id, item.id));

  return item.requestId;
}

export async function createWarehouseExitProjectReturn(params: {
  sourceWarehouseExitId: number;
  reasonCategory:
    | "material_defectuoso"
    | "excedente"
    | "error_pedido"
    | "cambio_especificacion"
    | "otro";
  justification: string;
  receivedByName: string;
  createdById: number;
  items: Array<{
    sourceWarehouseExitItemId: number;
    quantity: string;
    condition: "nuevo" | "usado_buen_estado" | "defectuoso" | "danado";
    notes?: string | null;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (params.items.length === 0) {
    throw new Error("Debe incluir al menos un ítem");
  }

  const detail = await getWarehouseExitById(params.sourceWarehouseExitId);
  if (!detail) {
    throw new Error("Salida de bodega no encontrada");
  }
  if (detail.warehouseExit.status !== "emitida") {
    throw new Error("Solo se pueden devolver materiales de salidas emitidas");
  }

  const sourceItemById = new Map(detail.items.map(item => [item.id, item]));
  const normalizedItems = params.items.map(item => {
    const sourceItem = sourceItemById.get(item.sourceWarehouseExitItemId);
    if (!sourceItem) {
      throw new Error(
        "La devolución incluye un ítem que no pertenece a la salida"
      );
    }

    const quantity = parseDecimal(item.quantity);
    const returnableQuantity = parseDecimal(sourceItem.returnableQuantity);
    if (quantity <= 0) {
      throw new Error(
        `La cantidad de ${sourceItem.itemName} debe ser mayor que cero`
      );
    }
    if (quantity - returnableQuantity > 0.000001) {
      throw new Error(
        `La cantidad de ${sourceItem.itemName} excede lo disponible para devolución`
      );
    }

    return {
      sourceItem,
      quantity: toDecimalString(quantity),
      condition: item.condition,
      notes: item.notes?.trim() || null,
    };
  });

  const returnNumber = await generateReturnNumber(
    detail.warehouseExit.projectId
  );
  const shouldReopenRequest = reverseLogisticReasonReopensRequest(
    params.reasonCategory
  );
  const [reverseLogistic] = await db
    .insert(reverseLogistics)
    .values({
      returnNumber,
      returnType: "devolucion_bodega_proyecto",
      reasonCategory: params.reasonCategory,
      justification: params.justification,
      sourceProjectId: detail.warehouseExit.projectId,
      sourceWarehouseExitId: params.sourceWarehouseExitId,
      originalRequestId: detail.warehouseExit.materialRequestId,
      receivedByName: params.receivedByName.trim(),
      status: "recibida",
      createdById: params.createdById,
      processedById: params.createdById,
      processedAt: new Date(),
    })
    .returning({ id: reverseLogistics.id });

  await db.insert(reverseLogisticsItems).values(
    normalizedItems.map(({ sourceItem, quantity, condition, notes }) => ({
      reverseLogisticId: reverseLogistic.id,
      sourceWarehouseExitItemId: sourceItem.id,
      warehouseId: sourceItem.warehouseId,
      itemName: sourceItem.itemName,
      sapItemCode: sourceItem.sapItemCode,
      quantity,
      unit: sourceItem.unit,
      condition,
      notes,
    }))
  );

  const reopenedRequestIds = new Set<number>();
  for (const { sourceItem, quantity } of normalizedItems) {
    await addInventoryStock({
      sapItemCode: sourceItem.sapItemCode,
      itemName: sourceItem.itemName,
      unit: sourceItem.unit,
      projectId: detail.warehouseExit.projectId,
      warehouseId: sourceItem.warehouseId ?? detail.warehouseExit.warehouseId,
      quantity,
    });

    if (shouldReopenRequest && sourceItem.materialRequestItemId) {
      const requestId = await reopenRequestItemAfterWarehouseReturn({
        requestItemId: sourceItem.materialRequestItemId,
        quantity,
        processedById: params.createdById,
      });
      if (requestId) reopenedRequestIds.add(requestId);
    }
  }

  for (const requestId of Array.from(reopenedRequestIds)) {
    await reopenMaterialRequestForWarehouseDispatch(
      requestId,
      params.createdById
    );
  }

  return {
    id: reverseLogistic.id,
    returnNumber,
    reopenedRequestIds: Array.from(reopenedRequestIds),
  };
}

export async function createReverseLogistic(
  data: Omit<InsertReverseLogistic, "returnNumber">,
  items: Omit<InsertReverseLogisticItem, "reverseLogisticId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const returnNumber = await generateReturnNumber(data.sourceProjectId);
  const isProjectWarehouseReturn =
    data.returnType === "devolucion_bodega_proyecto";
  const [reverseLogistic] = await db
    .insert(reverseLogistics)
    .values({
      ...data,
      returnNumber,
      status: isProjectWarehouseReturn ? "recibida" : data.status,
      processedById: isProjectWarehouseReturn
        ? data.createdById
        : data.processedById,
      processedAt: isProjectWarehouseReturn ? new Date() : data.processedAt,
    })
    .returning({ id: reverseLogistics.id });
  const reverseLogisticId = reverseLogistic.id;

  if (items.length > 0) {
    await db
      .insert(reverseLogisticsItems)
      .values(items.map(item => ({ ...item, reverseLogisticId })));
  }

  if (isProjectWarehouseReturn) {
    for (const item of items) {
      await addInventoryStock({
        sapItemCode: item.sapItemCode,
        itemName: item.itemName,
        unit: item.unit,
        projectId: data.sourceProjectId,
        warehouseId: item.warehouseId,
        quantity: item.quantity,
      });
    }
  }

  return { id: reverseLogisticId, returnNumber };
}

export async function listReverseLogistics(filters?: {
  returnType?: string;
  status?: string;
  sourceProjectId?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.returnType)
    conditions.push(eq(reverseLogistics.returnType, filters.returnType as any));
  if (filters?.status)
    conditions.push(eq(reverseLogistics.status, filters.status as any));
  if (filters?.sourceProjectId)
    conditions.push(
      eq(reverseLogistics.sourceProjectId, filters.sourceProjectId)
    );

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const destinationProjects = alias(
    projects,
    "reverse_logistics_destination_projects"
  );
  const destinationWarehouses = alias(
    warehouses,
    "reverse_logistics_destination_warehouses"
  );

  return db
    .select({
      return: reverseLogistics,
      sourceProject: projects,
      destinationProject: destinationProjects,
      destinationWarehouse: destinationWarehouses,
    })
    .from(reverseLogistics)
    .leftJoin(projects, eq(reverseLogistics.sourceProjectId, projects.id))
    .leftJoin(
      destinationProjects,
      eq(reverseLogistics.destinationProjectId, destinationProjects.id)
    )
    .leftJoin(
      destinationWarehouses,
      eq(reverseLogistics.destinationWarehouseId, destinationWarehouses.id)
    )
    .where(where)
    .orderBy(desc(reverseLogistics.createdAt));
}

export async function getReverseLogisticById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const itemWarehouses = alias(warehouses, "reverse_logistics_item_warehouses");
  const destinationProjects = alias(
    projects,
    "reverse_logistics_destination_projects"
  );
  const destinationWarehouses = alias(
    warehouses,
    "reverse_logistics_destination_warehouses"
  );
  const rows = await db
    .select({
      return: reverseLogistics,
      sourceProject: projects,
      destinationProject: destinationProjects,
      destinationWarehouse: destinationWarehouses,
      sourceWarehouseExit: warehouseExits,
      sourceReceipt: receipts,
      sourceWarehouse: warehouses,
      createdBy: users,
    })
    .from(reverseLogistics)
    .leftJoin(projects, eq(reverseLogistics.sourceProjectId, projects.id))
    .leftJoin(
      destinationProjects,
      eq(reverseLogistics.destinationProjectId, destinationProjects.id)
    )
    .leftJoin(
      destinationWarehouses,
      eq(reverseLogistics.destinationWarehouseId, destinationWarehouses.id)
    )
    .leftJoin(warehouses, eq(projects.warehouseId, warehouses.id))
    .leftJoin(users, eq(reverseLogistics.createdById, users.id))
    .leftJoin(
      warehouseExits,
      eq(reverseLogistics.sourceWarehouseExitId, warehouseExits.id)
    )
    .leftJoin(receipts, eq(reverseLogistics.sourceReceiptId, receipts.id))
    .where(eq(reverseLogistics.id, id))
    .limit(1);

  if (!rows[0]) return undefined;

  const itemRows = await db
    .select({
      item: reverseLogisticsItems,
      warehouse: itemWarehouses,
    })
    .from(reverseLogisticsItems)
    .leftJoin(
      itemWarehouses,
      eq(reverseLogisticsItems.warehouseId, itemWarehouses.id)
    )
    .where(eq(reverseLogisticsItems.reverseLogisticId, id));
  const items = itemRows.map(({ item, warehouse }) => ({ ...item, warehouse }));
  const linkedTransfers = await db
    .select({
      transferRequest: transferRequests,
      transfer: transfers,
      receipt: receipts,
    })
    .from(transferRequests)
    .leftJoin(transfers, eq(transfers.transferRequestId, transferRequests.id))
    .leftJoin(
      receipts,
      and(
        eq(receipts.sourceType, "transfer" as any),
        eq(receipts.sourceId, transfers.id)
      )
    )
    .where(eq(transferRequests.reverseLogisticId, id))
    .orderBy(
      desc(transferRequests.createdAt),
      desc(transfers.createdAt),
      desc(receipts.createdAt)
    );

  return { ...rows[0], items, linkedTransfers };
}

export async function createCentralWarehouseTransferFromReverseLogistic(
  id: number,
  createdById: number
) {
  return createTransferFromReverseLogistic(id, createdById);
}

export async function createTransferFromReverseLogistic(
  id: number,
  createdById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const detail = await getReverseLogisticById(id);
  if (!detail) {
    throw new Error("Devolución no encontrada");
  }

  const isCentralWarehouseReturn =
    detail.return.returnType === "devolucion_bodega_central";
  const isProjectTransferReturn =
    detail.return.returnType === "devolucion_entre_proyectos";

  if (!isCentralWarehouseReturn && !isProjectTransferReturn) {
    throw new Error(
      "Solo las devoluciones a Bodega Central o entre proyectos pueden generar traslado"
    );
  }

  if (detail.return.status !== "pendiente") {
    throw new Error(
      "Solo se puede crear traslado para devoluciones pendientes"
    );
  }

  const [activeTransferRequest] = await db
    .select({
      id: transferRequests.id,
      requestNumber: transferRequests.requestNumber,
    })
    .from(transferRequests)
    .where(
      and(
        eq(transferRequests.reverseLogisticId, id),
        inArray(transferRequests.status, [
          "pendiente",
          "aprobada",
          "convertida",
        ] as any)
      )
    )
    .limit(1);

  if (activeTransferRequest) {
    throw new Error(
      `Ya existe la solicitud de traslado ${activeTransferRequest.requestNumber} para esta devolución`
    );
  }

  if (detail.items.length === 0) {
    throw new Error("La devolución no tiene ítems para trasladar");
  }

  if (isProjectTransferReturn) {
    if (!detail.return.destinationProjectId) {
      throw new Error("La devolución no tiene proyecto destino");
    }

    if (!detail.return.destinationWarehouseId) {
      throw new Error("La devolución no tiene bodega destino");
    }

    const destinationWarehouses = await listProjectWarehouses(
      detail.return.destinationProjectId,
      { isActive: true }
    );
    const validDestinationWarehouse = destinationWarehouses.some(
      warehouse => warehouse.id === detail.return.destinationWarehouseId
    );
    if (!validDestinationWarehouse) {
      throw new Error(
        "La bodega destino ya no pertenece al proyecto destino o no está activa"
      );
    }
  }

  const activeWarehouses = await listProjectWarehouses(
    detail.return.sourceProjectId,
    { isActive: true }
  );
  const activeWarehouseIds = new Set(
    activeWarehouses.map(warehouse => warehouse.id)
  );

  const quantityByItem = new Map<
    string,
    {
      sapItemCode?: string | null;
      itemName: string;
      warehouseId: number;
      quantity: number;
    }
  >();

  for (const item of detail.items) {
    const quantity = parseDecimal(item.quantity);
    if (quantity <= 0) {
      throw new Error(
        `La cantidad de ${item.itemName} debe ser mayor que cero`
      );
    }

    if (!item.warehouseId || !activeWarehouseIds.has(item.warehouseId)) {
      throw new Error(
        `El almacén origen de ${item.itemName} no pertenece al proyecto origen o no está activo`
      );
    }
    if (
      isProjectTransferReturn &&
      detail.return.destinationWarehouseId &&
      item.warehouseId === detail.return.destinationWarehouseId
    ) {
      throw new Error(
        `${item.itemName}: la bodega destino no puede ser la misma bodega origen`
      );
    }

    const key = item.sapItemCode?.trim()
      ? `sap:${item.sapItemCode.trim()}::wh:${item.warehouseId}`
      : `name:${item.itemName.trim().toLowerCase()}::wh:${item.warehouseId}`;
    const current = quantityByItem.get(key);
    quantityByItem.set(key, {
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      warehouseId: item.warehouseId,
      quantity: (current?.quantity ?? 0) + quantity,
    });
  }

  for (const groupedItem of Array.from(quantityByItem.values())) {
    const rows = await listInventoryRowsForStock({
      sapItemCode: groupedItem.sapItemCode,
      itemName: groupedItem.itemName,
      projectId: detail.return.sourceProjectId,
      warehouseId: groupedItem.warehouseId,
    });
    const available = rows.reduce(
      (total, row) => total + parseDecimal(row.currentStock),
      0
    );

    if (available + 0.0001 < groupedItem.quantity) {
      throw new Error(
        `Stock insuficiente para ${groupedItem.itemName}. Disponible: ${toDecimalString(
          available
        )}, solicitado: ${toDecimalString(groupedItem.quantity)}.`
      );
    }
  }

  const transferRequest = await createTransferRequest(
    {
      materialRequestId: null,
      projectId: detail.return.sourceProjectId,
      destinationType: isCentralWarehouseReturn ? "bodega_central" : "proyecto",
      destinationProjectId: isProjectTransferReturn
        ? detail.return.destinationProjectId
        : null,
      reverseLogisticId: detail.return.id,
      createdById,
      status: "pendiente",
      neededBy: null,
      notes: [
        `Devolución ${detail.return.returnNumber}`,
        isProjectTransferReturn && detail.destinationWarehouse
          ? `Bodega destino: ${
              detail.destinationWarehouse.displayName ??
              detail.destinationWarehouse.name ??
              `#${detail.return.destinationWarehouseId}`
            }`
          : null,
        detail.return.justification,
      ]
        .filter(Boolean)
        .join("\n"),
      rejectionReason: null,
    },
    detail.items.map(item => ({
      materialRequestItemId: null,
      sourceWarehouseId: item.warehouseId,
      itemName: item.itemName,
      sapItemCode: item.sapItemCode,
      quantity: item.quantity,
      receivedQuantity: "0.00",
      unit: item.unit,
      notes: item.notes,
    }))
  );

  await updateReverseLogisticStatus(id, "aprobada", createdById);

  return transferRequest;
}

export async function updateReverseLogisticStatus(
  id: number,
  status: "pendiente" | "aprobada" | "en_transito" | "recibida" | "rechazada",
  processedById?: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const detail =
    status === "recibida" ? await getReverseLogisticById(id) : undefined;
  if (
    detail?.return.returnType === "devolucion_bodega_proyecto" &&
    detail.return.status !== "recibida"
  ) {
    for (const item of detail.items) {
      await addInventoryStock({
        sapItemCode: item.sapItemCode,
        itemName: item.itemName,
        unit: item.unit,
        projectId: detail.return.sourceProjectId,
        warehouseId: item.warehouseId,
        quantity: item.quantity,
      });
    }
  }

  const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
  if (processedById) {
    updateData.processedById = processedById;
    updateData.processedAt = new Date();
  }

  await db
    .update(reverseLogistics)
    .set(updateData)
    .where(eq(reverseLogistics.id, id));
  return { success: true };
}

function buildSupplierCreditNoteNumber(returnNumber: string) {
  return returnNumber.replace(/^DEV-/, "NC-");
}

export async function generateSupplierReturnCreditNote(
  id: number,
  processedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const detail = await getReverseLogisticById(id);
  if (!detail) {
    throw new Error("Devolución no encontrada");
  }

  if (detail.return.returnType !== "devolucion_proveedor") {
    throw new Error(
      "Solo las devoluciones a proveedor generan nota de crédito"
    );
  }

  if (detail.return.sapDocumentNumber) {
    return {
      success: true,
      status: detail.return.status,
      sapDocumentNumber: detail.return.sapDocumentNumber,
    };
  }

  if (detail.return.status !== "pendiente") {
    throw new Error(
      "Solo se puede generar nota de crédito para devoluciones pendientes"
    );
  }

  if (detail.items.length === 0) {
    throw new Error(
      "La devolución no tiene ítems para generar nota de crédito"
    );
  }

  const quantityByItem = new Map<
    string,
    {
      sapItemCode?: string | null;
      itemName: string;
      warehouseId?: number | null;
      quantity: number;
    }
  >();

  for (const item of detail.items) {
    const quantity = parseDecimal(item.quantity);
    if (quantity <= 0) {
      throw new Error(
        `La cantidad de ${item.itemName} debe ser mayor que cero`
      );
    }

    if (!item.warehouseId) {
      throw new Error(
        `La devolución de ${item.itemName} no tiene almacén origen`
      );
    }

    const key = item.sapItemCode?.trim()
      ? `sap:${item.sapItemCode.trim()}::wh:${item.warehouseId}`
      : `name:${item.itemName.trim().toLowerCase()}::wh:${item.warehouseId}`;
    const current = quantityByItem.get(key);
    quantityByItem.set(key, {
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      warehouseId: item.warehouseId,
      quantity: (current?.quantity ?? 0) + quantity,
    });
  }

  for (const groupedItem of Array.from(quantityByItem.values())) {
    const rows = await listInventoryRowsForStock({
      sapItemCode: groupedItem.sapItemCode,
      itemName: groupedItem.itemName,
      projectId: detail.return.sourceProjectId,
      warehouseId: groupedItem.warehouseId,
    });
    const available = rows.reduce(
      (total, row) => total + parseDecimal(row.currentStock),
      0
    );

    if (available + 0.0001 < groupedItem.quantity) {
      throw new Error(
        `Stock insuficiente para ${groupedItem.itemName}. Disponible: ${toDecimalString(
          available
        )}, solicitado: ${toDecimalString(groupedItem.quantity)}.`
      );
    }
  }

  for (const item of detail.items) {
    await consumeInventoryStock({
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      projectId: detail.return.sourceProjectId,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
    });
  }

  const sapDocumentNumber = buildSupplierCreditNoteNumber(
    detail.return.returnNumber
  );
  await db
    .update(reverseLogistics)
    .set({
      status: "aprobada",
      sapDocumentType: "nota_credito",
      sapDocumentNumber,
      sapSynced: false,
      processedById,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reverseLogistics.id, id));

  return {
    success: true,
    status: "aprobada" as const,
    sapDocumentNumber,
  };
}

// ============================================================
// ATTACHMENTS
// ============================================================
export async function createAttachment(data: InsertAttachment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [attachment] = await db
    .insert(attachments)
    .values(data)
    .returning({ id: attachments.id });
  return { id: attachment.id };
}

export async function getAttachmentsByEntity(
  entityType: AttachmentEntityType,
  entityId: number
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId)
      )
    )
    .orderBy(desc(attachments.createdAt));
}

export async function getAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [attachment] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  return attachment;
}

export async function deleteAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(attachments).where(eq(attachments.id, id));
  return { success: true };
}

// ============================================================
// NOTIFICATIONS
// ============================================================
export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [notification] = await db
    .insert(notifications)
    .values(data)
    .returning({ id: notifications.id });
  return { id: notification.id };
}

export async function getUserNotifications(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), eq(notifications.isRead, false))
    );
  return result[0]?.count ?? 0;
}

export async function markNotificationAsRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, id));
  return { success: true };
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(eq(notifications.userId, userId), eq(notifications.isRead, false))
    );
  return { success: true };
}

export async function notifyExpiringPurchaseOrderContracts(now = new Date()) {
  const db = await getDb();
  if (!db) return { notifiedContracts: 0, notificationsCreated: 0 };

  const rows = await db
    .select({
      purchaseOrder: purchaseOrders,
      project: projects,
    })
    .from(purchaseOrders)
    .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .where(
      and(
        eq(purchaseOrders.appliesContract, true),
        sql`${purchaseOrders.contractExpiryNotifiedAt} IS NULL`,
        sql`${purchaseOrders.status} <> 'anulada'`
      )
    );

  const invoiceCountMap = await getPurchaseOrderInvoiceCountMap(
    rows.map(row => row.purchaseOrder.id)
  );
  let notifiedContracts = 0;
  let notificationsCreated = 0;

  for (const row of rows) {
    const summary = getPurchaseOrderContractSummary({
      appliesContract: row.purchaseOrder.appliesContract,
      contractPaymentFrequency: row.purchaseOrder.contractPaymentFrequency,
      contractFirstPaymentDate: row.purchaseOrder.contractFirstPaymentDate,
      contractEndDate: row.purchaseOrder.contractEndDate,
      registeredInvoiceCount: invoiceCountMap.get(row.purchaseOrder.id) ?? 0,
      now,
    });
    if (!summary.expiresSoon || summary.isFullyInvoiced) continue;

    const [centralAdmins, projectAdmins] = await Promise.all([
      getUsersByBuildreqRole("administracion_central"),
      getUsersByBuildreqRoleAndProject(
        "administrador_proyecto",
        row.purchaseOrder.projectId
      ),
    ]);
    const recipients = new Map(
      [...centralAdmins, ...projectAdmins].map(user => [user.id, user])
    );
    const endDateLabel = formatDateLabel(row.purchaseOrder.contractEndDate);
    const projectLabel = row.project
      ? `${row.project.code} — ${row.project.name}`
      : `Proyecto ${row.purchaseOrder.projectId}`;

    for (const recipient of Array.from(recipients.values())) {
      await createNotification({
        userId: recipient.id,
        title: "Contrato próximo a vencer",
        message: `La OC ${row.purchaseOrder.orderNumber} del ${projectLabel} vence el ${endDateLabel}. ${summary.statusLabel}.`,
        type: "orden_compra",
        relatedEntityType: "purchase_order",
        relatedEntityId: row.purchaseOrder.id,
      });
      notificationsCreated += 1;
    }

    await db
      .update(purchaseOrders)
      .set({ contractExpiryNotifiedAt: now, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, row.purchaseOrder.id));
    notifiedContracts += 1;
  }

  return { notifiedContracts, notificationsCreated };
}

// ============================================================
// WAREHOUSES
// ============================================================
type WarehouseSeedInput = {
  code: string;
  name: string;
  description?: string;
};

function normalizeWarehouseCode(code: string) {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWarehouseName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeWarehouseLocationKey(value?: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function buildWarehouseDisplayName(code: string, name: string) {
  return `${normalizeWarehouseCode(code)} - ${normalizeWarehouseName(name).toUpperCase()}`;
}

function parseWarehouseLocation(value?: string | null) {
  const normalized = normalizeWarehouseLocationKey(value);
  if (!normalized) return null;

  const separatorIndex = normalized.indexOf(" - ");
  if (separatorIndex === -1) return null;

  const code = normalized.slice(0, separatorIndex).trim();
  const name = normalized.slice(separatorIndex + 3).trim();

  if (!code || !name) return null;

  return {
    code,
    name,
  };
}

async function getWarehouseById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .limit(1);
  return rows[0];
}

async function getProjectAssignedWarehouseByProjectId(projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return undefined;
  const warehousesByProjectId = await getProjectWarehousesByProjectId(db, [
    project,
  ]);
  return warehousesByProjectId.get(projectId)?.[0];
}

export async function listProjectWarehouses(
  projectId: number,
  filters?: { isActive?: boolean }
) {
  const db = await getDb();
  if (!db) return [] as Warehouse[];
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return [] as Warehouse[];

  const warehousesByProjectId = await getProjectWarehousesByProjectId(db, [
    project,
  ]);
  const projectWarehouses = warehousesByProjectId.get(projectId) ?? [];
  if (filters?.isActive === undefined) return projectWarehouses;
  return projectWarehouses.filter(
    warehouse => warehouse.isActive === filters.isActive
  );
}

async function getWarehouseAssignedUsersByWarehouseIds(warehouseIds: number[]) {
  const db = await getDb();
  if (!db || warehouseIds.length === 0) {
    return new Map<number, ReturnType<typeof mapWarehouseAssignedUser>[]>();
  }

  const rows = await db
    .select({
      warehouseId: warehouseUserAssignments.warehouseId,
      assignment: warehouseUserAssignments,
      user: users,
    })
    .from(warehouseUserAssignments)
    .innerJoin(users, eq(warehouseUserAssignments.userId, users.id))
    .where(inArray(warehouseUserAssignments.warehouseId, warehouseIds))
    .orderBy(
      asc(warehouseUserAssignments.warehouseId),
      desc(warehouseUserAssignments.isResponsible),
      asc(users.name),
      asc(users.email)
    );

  const assignedUsersByWarehouseId = new Map<
    number,
    ReturnType<typeof mapWarehouseAssignedUser>[]
  >();
  for (const row of rows) {
    const current = assignedUsersByWarehouseId.get(row.warehouseId) ?? [];
    current.push(mapWarehouseAssignedUser(row));
    assignedUsersByWarehouseId.set(row.warehouseId, current);
  }

  return assignedUsersByWarehouseId;
}

async function listInventoryRowsForStock(params: {
  sapItemCode?: string | null;
  itemName: string;
  projectId?: number | null;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  if (!db) return [] as InventoryItem[];

  const conditions = [];
  const normalizedSapItemCode = params.sapItemCode?.trim();

  if (normalizedSapItemCode) {
    conditions.push(eq(inventoryItems.sapItemCode, normalizedSapItemCode));
  } else {
    conditions.push(
      sql`lower(${inventoryItems.name}) = lower(${params.itemName})`
    );
  }

  if (params.warehouseId) {
    conditions.push(eq(inventoryItems.warehouseId, params.warehouseId));
  } else if (params.warehouseLocation?.trim()) {
    conditions.push(
      eq(inventoryItems.warehouseLocation, params.warehouseLocation.trim())
    );
  }

  if (params.projectId === null || params.projectId === undefined) {
    conditions.push(sql`${inventoryItems.projectId} IS NULL`);
  } else {
    conditions.push(eq(inventoryItems.projectId, params.projectId));
  }

  return db
    .select()
    .from(inventoryItems)
    .where(and(...conditions))
    .orderBy(asc(inventoryItems.id));
}

async function consumeInventoryStock(params: {
  sapItemCode?: string | null;
  itemName: string;
  projectId?: number | null;
  quantity: string | number;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const quantityToConsume = parseDecimal(params.quantity);
  if (quantityToConsume <= 0) {
    return { consumedQuantity: 0 };
  }
  await resolveProjectAssignment(params.projectId, params.warehouseId);

  const rows = await listInventoryRowsForStock(params);
  const available = rows.reduce(
    (total, row) => total + parseDecimal(row.currentStock),
    0
  );

  if (available + 0.0001 < quantityToConsume) {
    throw new Error(
      `Stock insuficiente para ${params.itemName}. Disponible: ${toDecimalString(
        available
      )}, solicitado: ${toDecimalString(quantityToConsume)}.`
    );
  }

  let pending = quantityToConsume;

  for (const row of rows) {
    if (pending <= 0) break;

    const currentStock = parseDecimal(row.currentStock);
    if (currentStock <= 0) continue;

    const discount = Math.min(currentStock, pending);
    await db
      .update(inventoryItems)
      .set({
        currentStock: toDecimalString(currentStock - discount),
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, row.id));

    pending -= discount;
  }

  return {
    consumedQuantity: quantityToConsume,
  };
}

async function consumeInventoryStockWithClient(
  client: any,
  params: {
    sapItemCode?: string | null;
    itemName: string;
    projectId?: number | null;
    quantity: string | number;
    warehouseId?: number | null;
    warehouseLocation?: string | null;
  }
) {
  const quantityToConsume = parseDecimal(params.quantity);
  if (quantityToConsume <= 0) {
    return { consumedQuantity: 0 };
  }

  const conditions = [];
  const normalizedSapItemCode = params.sapItemCode?.trim();

  if (normalizedSapItemCode) {
    conditions.push(eq(inventoryItems.sapItemCode, normalizedSapItemCode));
  } else {
    conditions.push(
      sql`lower(${inventoryItems.name}) = lower(${params.itemName})`
    );
  }

  if (params.warehouseId) {
    conditions.push(eq(inventoryItems.warehouseId, params.warehouseId));
  } else if (params.warehouseLocation?.trim()) {
    conditions.push(
      eq(inventoryItems.warehouseLocation, params.warehouseLocation.trim())
    );
  }

  if (params.projectId === null || params.projectId === undefined) {
    throw new Error("Seleccione proyecto/bodega para afectar inventario");
  }
  const [projectAssignment] = await client
    .select({
      projectId: projectWarehouseAssignments.projectId,
      warehouseId: projectWarehouseAssignments.warehouseId,
    })
    .from(projectWarehouseAssignments)
    .innerJoin(warehouses, eq(projectWarehouseAssignments.warehouseId, warehouses.id))
    .where(
      and(
        eq(projectWarehouseAssignments.projectId, params.projectId),
        params.warehouseId
          ? eq(projectWarehouseAssignments.warehouseId, params.warehouseId)
          : sql`true`,
        eq(warehouses.isActive, true)
      )
    )
    .limit(1);
  if (!projectAssignment) {
    throw new Error("El almacén seleccionado no está asignado al proyecto");
  }
  conditions.push(eq(inventoryItems.projectId, params.projectId));

  const rows = await client
    .select()
    .from(inventoryItems)
    .where(and(...conditions))
    .orderBy(asc(inventoryItems.id));

  const available = rows.reduce(
    (total: number, row: InventoryItem) =>
      total + parseDecimal(row.currentStock),
    0
  );

  if (available + 0.0001 < quantityToConsume) {
    throw new Error(
      `Stock insuficiente para ${params.itemName}. Disponible: ${toDecimalString(
        available
      )}, necesario para corregir: ${toDecimalString(quantityToConsume)}.`
    );
  }

  let pending = quantityToConsume;

  for (const row of rows as InventoryItem[]) {
    if (pending <= 0) break;

    const currentStock = parseDecimal(row.currentStock);
    if (currentStock <= 0) continue;

    const discount = Math.min(currentStock, pending);
    await client
      .update(inventoryItems)
      .set({
        currentStock: toDecimalString(currentStock - discount),
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, row.id));

    pending -= discount;
  }

  return {
    consumedQuantity: quantityToConsume,
  };
}

async function addInventoryStock(params: {
  sapItemCode?: string | null;
  itemName: string;
  description?: string | null;
  unit?: string | null;
  projectId?: number | null;
  quantity: string | number;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const quantityToAdd = parseDecimal(params.quantity);
  if (quantityToAdd <= 0) {
    return { addedQuantity: 0, inventoryItemId: null };
  }
  if (params.projectId === null || params.projectId === undefined) {
    throw new Error(
      "Seleccione proyecto/bodega para registrar inventario operativo"
    );
  }

  const normalizedSapItemCode = params.sapItemCode?.trim() || null;
  const projectAssignment = await resolveProjectAssignment(
    params.projectId,
    params.warehouseId
  );
  if (!projectAssignment) {
    throw new Error("Seleccione proyecto/bodega para registrar inventario");
  }
  const warehouseAssignment = {
    warehouseId: projectAssignment.warehouseId,
    warehouseLocation: projectAssignment.warehouseLocation,
  };
  const inventoryProjectId =
    getInventoryProjectIdForAssignment(projectAssignment);

  const rows = await listInventoryRowsForStock({
    sapItemCode: normalizedSapItemCode,
    itemName: params.itemName,
    projectId: inventoryProjectId,
    warehouseId: warehouseAssignment.warehouseId,
    warehouseLocation: warehouseAssignment.warehouseLocation,
  });
  const existingRow = rows[0];

  if (existingRow) {
    const nextStock = parseDecimal(existingRow.currentStock) + quantityToAdd;
    await db
      .update(inventoryItems)
      .set({
        name: existingRow.name || params.itemName,
        description: existingRow.description ?? params.description ?? null,
        unit: existingRow.unit ?? params.unit ?? null,
        projectId: inventoryProjectId,
        warehouseId: warehouseAssignment.warehouseId,
        warehouseLocation: warehouseAssignment.warehouseLocation,
        currentStock: toDecimalString(nextStock),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, existingRow.id));

    return {
      addedQuantity: quantityToAdd,
      inventoryItemId: existingRow.id,
    };
  }

  if (!normalizedSapItemCode) {
    throw new Error(
      `El ítem ${params.itemName} debe tener código SAP para registrarse en inventario.`
    );
  }

  const [created] = await db
    .insert(inventoryItems)
    .values({
      sapItemCode: normalizedSapItemCode,
      name: params.itemName,
      description: params.description ?? null,
      unit: params.unit ?? null,
      currentStock: toDecimalString(quantityToAdd),
      projectId: inventoryProjectId,
      warehouseId: warehouseAssignment.warehouseId,
      warehouseLocation: warehouseAssignment.warehouseLocation,
      isActive: true,
    })
    .returning({ id: inventoryItems.id });

  return {
    addedQuantity: quantityToAdd,
    inventoryItemId: created.id,
  };
}

async function syncInventoryItemsToAssignedWarehouse(
  projectId: number,
  warehouse: Warehouse | null
) {
  const db = await getDb();
  if (!db) return { linkedRows: 0 };

  const result = await db
    .update(inventoryItems)
    .set({
      warehouseId: warehouse?.id ?? null,
      warehouseLocation: warehouse?.displayName ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryItems.projectId, projectId),
        or(
          sql`${inventoryItems.warehouseId} IS DISTINCT FROM ${warehouse?.id ?? null}`,
          sql`${inventoryItems.warehouseLocation} IS DISTINCT FROM ${warehouse?.displayName ?? null}`
        )
      )
    )
    .returning({ id: inventoryItems.id });

  return {
    linkedRows: result.length,
  };
}

async function ensureWarehouses(seedInputs: WarehouseSeedInput[]) {
  const db = await getDb();
  if (!db || seedInputs.length === 0) return [] as Warehouse[];

  const uniqueInputs = Array.from(
    new Map(
      seedInputs
        .filter(input => input.code.trim() && input.name.trim())
        .map(input => {
          const code = normalizeWarehouseCode(input.code);
          const name = normalizeWarehouseName(input.name);
          return [
            code,
            {
              code,
              name,
              displayName: buildWarehouseDisplayName(code, name),
              description: input.description?.trim() || null,
              isActive: true,
              updatedAt: new Date(),
            } satisfies InsertWarehouse,
          ];
        })
    ).values()
  );

  if (uniqueInputs.length === 0) return [] as Warehouse[];

  const codes = uniqueInputs.map(input => input.code);
  const existingWarehouses = await db
    .select()
    .from(warehouses)
    .where(inArray(warehouses.code, codes));

  const existingCodes = new Set(
    existingWarehouses.map(warehouse => warehouse.code)
  );
  const warehousesToInsert = uniqueInputs.filter(
    input => !existingCodes.has(input.code)
  );

  if (warehousesToInsert.length > 0) {
    await db
      .insert(warehouses)
      .values(warehousesToInsert)
      .onConflictDoNothing();
  }

  return db
    .select()
    .from(warehouses)
    .where(inArray(warehouses.code, codes))
    .orderBy(asc(warehouses.code));
}

async function linkInventoryItemsToWarehousesByLocation(
  targetWarehouses?: Warehouse[]
) {
  const db = await getDb();
  if (!db) return { linkedRows: 0 };

  const warehouseRows =
    targetWarehouses && targetWarehouses.length > 0
      ? targetWarehouses
      : await db.select().from(warehouses).where(eq(warehouses.isActive, true));

  if (warehouseRows.length === 0) {
    return { linkedRows: 0 };
  }

  const inventoryRows = await db
    .select({
      id: inventoryItems.id,
      warehouseId: inventoryItems.warehouseId,
      warehouseLocation: inventoryItems.warehouseLocation,
    })
    .from(inventoryItems)
    .where(isNotNull(inventoryItems.warehouseLocation));

  const warehouseMap = new Map(
    warehouseRows.map(warehouse => [
      normalizeWarehouseLocationKey(warehouse.displayName),
      warehouse,
    ])
  );

  const updatesByWarehouse = new Map<
    number,
    { warehouse: Warehouse; ids: number[] }
  >();

  for (const row of inventoryRows) {
    const locationKey = normalizeWarehouseLocationKey(row.warehouseLocation);
    if (!locationKey) continue;

    const matchedWarehouse = warehouseMap.get(locationKey);
    if (!matchedWarehouse || row.warehouseId === matchedWarehouse.id) continue;

    const updateBucket = updatesByWarehouse.get(matchedWarehouse.id);
    if (updateBucket) {
      updateBucket.ids.push(row.id);
      continue;
    }

    updatesByWarehouse.set(matchedWarehouse.id, {
      warehouse: matchedWarehouse,
      ids: [row.id],
    });
  }

  let linkedRows = 0;

  for (const { warehouse, ids } of Array.from(updatesByWarehouse.values())) {
    for (const idChunk of chunkItems<number>(ids, DEMO_IMPORT_BATCH_SIZE)) {
      await db
        .update(inventoryItems)
        .set({
          warehouseId: warehouse.id,
          warehouseLocation: warehouse.displayName,
          updatedAt: new Date(),
        })
        .where(inArray(inventoryItems.id, idChunk));
      linkedRows += idChunk.length;
    }
  }

  return { linkedRows };
}

async function resolveWarehouseAssignment(
  warehouseId?: number | null,
  warehouseLocation?: string | null
) {
  const db = await getDb();
  if (!db) {
    return {
      warehouseId: warehouseId ?? null,
      warehouseLocation: warehouseLocation?.trim() || null,
      isSharedWarehouse: false,
    };
  }

  if (warehouseId) {
    const [warehouse] = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);

    if (!warehouse) {
      throw new Error("El almacén seleccionado no existe");
    }

    return {
      warehouseId: warehouse.id,
      warehouseLocation: warehouse.displayName,
      isSharedWarehouse: warehouse.isSharedWarehouse,
    };
  }

  const parsedLocation = parseWarehouseLocation(warehouseLocation);
  if (!parsedLocation) {
    return {
      warehouseId: null,
      warehouseLocation: warehouseLocation?.trim() || null,
      isSharedWarehouse: false,
    };
  }

  const [warehouse] = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.code, parsedLocation.code))
    .limit(1);

  if (!warehouse) {
    return {
      warehouseId: null,
      warehouseLocation: buildWarehouseDisplayName(
        parsedLocation.code,
        parsedLocation.name
      ),
      isSharedWarehouse: false,
    };
  }

  return {
    warehouseId: warehouse.id,
    warehouseLocation: warehouse.displayName,
    isSharedWarehouse: warehouse.isSharedWarehouse,
  };
}

export async function listWarehouses(filters?: {
  isActive?: boolean;
  projectId?: number;
  projectIds?: number[];
  assignedUserId?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.isActive !== undefined) {
    conditions.push(eq(warehouses.isActive, filters.isActive));
  }
  const scopedProjectIds = filters?.projectId
    ? [filters.projectId]
    : filters?.projectIds;
  if (scopedProjectIds) {
    if (scopedProjectIds.length === 0) return [];
    const [assignmentRows, legacyRows] = await Promise.all([
      db
        .select({ warehouseId: projectWarehouseAssignments.warehouseId })
        .from(projectWarehouseAssignments)
        .where(
          inArray(projectWarehouseAssignments.projectId, scopedProjectIds)
        ),
      db
        .select({ warehouseId: projects.warehouseId })
        .from(projects)
        .where(inArray(projects.id, scopedProjectIds)),
    ]);
    const assignedWarehouseIds = Array.from(
      new Set(
        [...assignmentRows, ...legacyRows]
          .map(row => row.warehouseId)
          .filter((id): id is number => typeof id === "number")
      )
    );
    if (assignedWarehouseIds.length === 0) return [];
    conditions.push(inArray(warehouses.id, assignedWarehouseIds));
  }
  if (filters?.assignedUserId) {
    const assignedRows = await db
      .select({ warehouseId: warehouseUserAssignments.warehouseId })
      .from(warehouseUserAssignments)
      .where(eq(warehouseUserAssignments.userId, filters.assignedUserId));
    const assignedWarehouseIds = Array.from(
      new Set(assignedRows.map(row => row.warehouseId))
    );
    if (assignedWarehouseIds.length === 0) return [];
    conditions.push(inArray(warehouses.id, assignedWarehouseIds));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      warehouse: warehouses,
      projectCount: sql<number>`(
        select count(distinct ${projectWarehouseAssignments.projectId})::int
        from ${projectWarehouseAssignments}
        where ${projectWarehouseAssignments.warehouseId} = ${warehouses.id}
      )`,
      inventoryRows: sql<number>`count(distinct ${inventoryItems.id})`,
      uniqueItems: sql<number>`count(distinct ${inventoryItems.sapItemCode})`,
      totalStock: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
    })
    .from(warehouses)
    .leftJoin(inventoryItems, eq(inventoryItems.warehouseId, warehouses.id))
    .where(where)
    .groupBy(
      warehouses.id,
      warehouses.code,
      warehouses.localCode,
      warehouses.name,
      warehouses.displayName,
      warehouses.description,
      warehouses.isDefault,
      warehouses.isCentralWarehouse,
      warehouses.isSharedWarehouse,
      warehouses.isActive,
      warehouses.createdAt,
      warehouses.updatedAt
    )
    .orderBy(asc(warehouses.name), asc(warehouses.code));

  const assignedUsersByWarehouseId =
    await getWarehouseAssignedUsersByWarehouseIds(
      rows.map(row => row.warehouse.id)
    );

  return rows.map(
    ({ warehouse, projectCount, inventoryRows, uniqueItems, totalStock }) => {
      const assignedUsers = assignedUsersByWarehouseId.get(warehouse.id) ?? [];
      return {
        ...warehouse,
        warehouseType: "padre",
        project: null,
        responsibleUser: assignedUsers.find(user => user.isResponsible) ?? null,
        assignedUsersCount: assignedUsers.length,
        projectCount: Number(projectCount ?? 0),
        assignedProjectsCount: Number(projectCount ?? 0),
        inventoryRows: Number(inventoryRows ?? 0),
        uniqueItems: Number(uniqueItems ?? 0),
        totalStock: toDecimalString(totalStock),
      };
    }
  );
}

export async function createWarehouse(data: {
  code: string;
  localCode?: string | null;
  name: string;
  description?: string | null;
  isCentralWarehouse?: boolean;
  isSharedWarehouse?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const code = normalizeWarehouseCode(data.code);
  const name = normalizeWarehouseName(data.name);
  if (!code || !name) {
    throw new Error("Código y nombre del almacén son obligatorios");
  }

  const existingRows = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      or(
        eq(warehouses.code, code),
        eq(warehouses.displayName, buildWarehouseDisplayName(code, name))
      )
    )
    .limit(1);

  if (existingRows[0]) {
    throw new Error("Ya existe un almacén con ese código o etiqueta");
  }

  const warehousePayload = {
    code,
    localCode: data.localCode
      ? normalizeWarehouseCode(data.localCode).slice(0, 20)
      : code.slice(0, 20),
    name,
    displayName: buildWarehouseDisplayName(code, name),
    description: data.description?.trim() || null,
    isDefault: false,
    isCentralWarehouse: Boolean(data.isCentralWarehouse),
    isSharedWarehouse: Boolean(data.isSharedWarehouse),
    isActive: true,
  } satisfies InsertWarehouse;

  const warehouse = warehousePayload.isCentralWarehouse
    ? await db.transaction(async tx => {
        await tx
          .update(warehouses)
          .set({ isCentralWarehouse: false, updatedAt: new Date() })
          .where(eq(warehouses.isCentralWarehouse, true));
        const [createdWarehouse] = await tx
          .insert(warehouses)
          .values(warehousePayload)
          .returning();
        return createdWarehouse;
      })
    : await db
        .insert(warehouses)
        .values(warehousePayload)
        .returning()
        .then(rows => rows[0]);

  return {
    warehouse,
    linkedRows: 0,
  };
}

export async function getWarehouseDetailById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      warehouse: warehouses,
      projectCount: sql<number>`(
        select count(distinct ${projectWarehouseAssignments.projectId})::int
        from ${projectWarehouseAssignments}
        where ${projectWarehouseAssignments.warehouseId} = ${warehouses.id}
      )`,
      inventoryRows: count(inventoryItems.id),
      totalStock: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
      uniqueItems: sql<number>`count(distinct ${inventoryItems.sapItemCode})`,
    })
    .from(warehouses)
    .leftJoin(inventoryItems, eq(inventoryItems.warehouseId, warehouses.id))
    .where(eq(warehouses.id, id))
    .groupBy(
      warehouses.id,
      warehouses.code,
      warehouses.localCode,
      warehouses.name,
      warehouses.displayName,
      warehouses.description,
      warehouses.isDefault,
      warehouses.isCentralWarehouse,
      warehouses.isSharedWarehouse,
      warehouses.isActive,
      warehouses.createdAt,
      warehouses.updatedAt
    )
    .limit(1);

  if (!rows[0]) return undefined;
  const assignedProjects = await db
    .select({
      project: projects,
      isPrimary: projectWarehouseAssignments.isPrimary,
    })
    .from(projectWarehouseAssignments)
    .innerJoin(projects, eq(projectWarehouseAssignments.projectId, projects.id))
    .where(eq(projectWarehouseAssignments.warehouseId, id))
    .orderBy(asc(projects.code), asc(projects.name));
  const assignedUsersByWarehouseId =
    await getWarehouseAssignedUsersByWarehouseIds([id]);
  const assignedUsers = assignedUsersByWarehouseId.get(id) ?? [];
  return {
    ...rows[0].warehouse,
    project: null,
    projects: assignedProjects.map(row => ({
      id: row.project.id,
      code: row.project.code,
      name: row.project.name,
      status: row.project.status,
      location: row.project.location,
      sapProjectCode: row.project.sapProjectCode,
      isPrimary: row.isPrimary,
    })),
    responsibleUser: assignedUsers.find(user => user.isResponsible) ?? null,
    assignedUsers,
    assignedUsersCount: assignedUsers.length,
    projectCount: Number(rows[0].projectCount ?? 0),
    assignedProjectsCount: Number(rows[0].projectCount ?? 0),
    inventoryRows: Number(rows[0].inventoryRows ?? 0),
    uniqueItems: Number(rows[0].uniqueItems ?? 0),
    totalStock: toDecimalString(rows[0].totalStock),
  };
}

export async function updateWarehouse(
  id: number,
  data: {
    code?: string | null;
    localCode?: string | null;
    name?: string | null;
    description?: string | null;
    isActive?: boolean;
    isCentralWarehouse?: boolean;
    isSharedWarehouse?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const warehouse = await getWarehouseById(id);
  if (!warehouse) throw new Error("Almacén no encontrado");

  const nextCode =
    data.code !== undefined && data.code !== null && data.code.trim()
      ? normalizeWarehouseCode(data.code)
      : warehouse.code;
  const nextLocalCode =
    data.localCode !== undefined
      ? data.localCode
        ? normalizeWarehouseCode(data.localCode).slice(0, 20)
        : null
      : warehouse.localCode;
  const nextName =
    data.name !== undefined && data.name !== null && data.name.trim()
      ? normalizeWarehouseName(data.name)
      : warehouse.name;
  const nextIsActive = data.isActive ?? warehouse.isActive;
  const nextIsCentralWarehouse =
    data.isCentralWarehouse ?? warehouse.isCentralWarehouse;
  const nextIsSharedWarehouse =
    data.isSharedWarehouse ?? warehouse.isSharedWarehouse;
  const nextDisplayName = buildWarehouseDisplayName(nextCode, nextName);

  if (
    nextCode !== warehouse.code ||
    nextDisplayName !== warehouse.displayName
  ) {
    const duplicateRows = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(
          or(
            eq(warehouses.code, nextCode),
            eq(warehouses.displayName, nextDisplayName)
          )!,
          sql`${warehouses.id} <> ${warehouse.id}`
        )
      )
      .limit(1);
    if (duplicateRows[0]) {
      throw new Error("Ya existe un almacén con ese código o etiqueta");
    }
  }

  const now = new Date();
  await db.transaction(async tx => {
    if (data.isCentralWarehouse === true) {
      await tx
        .update(warehouses)
        .set({ isCentralWarehouse: false, updatedAt: now })
        .where(
          and(
            eq(warehouses.isCentralWarehouse, true),
            sql`${warehouses.id} <> ${id}`
          )
        );
    }

    await tx
      .update(warehouses)
      .set({
        code: nextCode,
        localCode: nextLocalCode,
        name: nextName,
        displayName: nextDisplayName,
        description:
          data.description !== undefined
            ? data.description?.trim() || null
            : warehouse.description,
        isActive: nextIsActive,
        isCentralWarehouse: nextIsCentralWarehouse,
        isSharedWarehouse: nextIsSharedWarehouse,
        updatedAt: now,
      })
      .where(eq(warehouses.id, id));

    if (nextDisplayName !== warehouse.displayName) {
      await tx
        .update(inventoryItems)
        .set({ warehouseLocation: nextDisplayName, updatedAt: now })
        .where(eq(inventoryItems.warehouseId, id));
    }
  });

  return { success: true };
}

export async function assignProjectToWarehouse(params: {
  projectId: number;
  warehouseId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const project = await getProjectById(params.projectId);
  if (!project) throw new Error("Proyecto no encontrado");

  const warehouse = await getWarehouseById(params.warehouseId);
  if (!warehouse) throw new Error("Almacén no encontrado");
  if (!warehouse.isActive) {
    throw new Error("No se puede asignar un almacén inactivo");
  }

  const shouldSetPrimary = !project.warehouseId;
  await db.transaction(async tx => {
    if (shouldSetPrimary) {
      await tx
        .update(projectWarehouseAssignments)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(eq(projectWarehouseAssignments.projectId, params.projectId));
    }

    const [existing] = await tx
      .select()
      .from(projectWarehouseAssignments)
      .where(
        and(
          eq(projectWarehouseAssignments.projectId, params.projectId),
          eq(projectWarehouseAssignments.warehouseId, warehouse.id)
        )
      )
      .limit(1);

    if (existing) {
      await tx
        .update(projectWarehouseAssignments)
        .set({
          isPrimary: shouldSetPrimary ? true : existing.isPrimary,
          updatedAt: new Date(),
        })
        .where(eq(projectWarehouseAssignments.id, existing.id));
    } else {
      await tx.insert(projectWarehouseAssignments).values({
        projectId: params.projectId,
        warehouseId: warehouse.id,
        isPrimary: shouldSetPrimary,
      });
    }

    if (shouldSetPrimary) {
      await tx
        .update(projects)
        .set({ warehouseId: warehouse.id, updatedAt: new Date() })
        .where(eq(projects.id, params.projectId));
    }
  });

  const syncResult = shouldSetPrimary
    ? await syncInventoryItemsToAssignedWarehouse(params.projectId, warehouse)
    : { linkedRows: 0 };

  return { success: true, linkedRows: syncResult.linkedRows };
}

export async function setProjectPrimaryWarehouse(params: {
  projectId: number;
  warehouseId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const project = await getProjectById(params.projectId);
  if (!project) throw new Error("Proyecto no encontrado");

  const warehouse = await getWarehouseById(params.warehouseId);
  if (!warehouse) throw new Error("Almacén no encontrado");
  if (!warehouse.isActive) {
    throw new Error("No se puede marcar como principal un almacén inactivo");
  }

  const [assignment] = await db
    .select()
    .from(projectWarehouseAssignments)
    .where(
      and(
        eq(projectWarehouseAssignments.projectId, params.projectId),
        eq(projectWarehouseAssignments.warehouseId, params.warehouseId)
      )
    )
    .limit(1);

  if (!assignment) {
    throw new Error(
      "La bodega debe estar asignada al proyecto antes de marcarla como principal"
    );
  }

  await db.transaction(async tx => {
    await tx
      .update(projectWarehouseAssignments)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(eq(projectWarehouseAssignments.projectId, params.projectId));

    await tx
      .update(projectWarehouseAssignments)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(projectWarehouseAssignments.id, assignment.id));

    await tx
      .update(projects)
      .set({ warehouseId: params.warehouseId, updatedAt: new Date() })
      .where(eq(projects.id, params.projectId));
  });

  return { success: true };
}

export async function unassignProjectFromWarehouse(params: {
  projectId: number;
  warehouseId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const project = await getProjectById(params.projectId);
  if (!project) throw new Error("Proyecto no encontrado");
  const assignedWarehouses = await listProjectWarehouses(params.projectId);
  if (assignedWarehouses.length === 0) {
    return { success: true, linkedRows: 0 };
  }
  if (
    params.warehouseId &&
    !assignedWarehouses.some(warehouse => warehouse.id === params.warehouseId)
  ) {
    throw new Error("El proyecto no está asignado a ese almacén");
  }

  const inventoryConditions = [
    eq(inventoryItems.projectId, params.projectId),
    eq(inventoryItems.isActive, true),
    sql`${inventoryItems.currentStock}::numeric > 0`,
  ];
  if (params.warehouseId) {
    inventoryConditions.push(
      eq(inventoryItems.warehouseId, params.warehouseId)
    );
  }

  const [stockRow] = await db
    .select({ totalRows: count() })
    .from(inventoryItems)
    .where(and(...inventoryConditions));
  if (Number(stockRow?.totalRows ?? 0) > 0) {
    throw new Error(
      "No se puede quitar la bodega porque el proyecto tiene inventario activo"
    );
  }

  let nextPrimaryWarehouseId: number | null = project.warehouseId ?? null;
  await db.transaction(async tx => {
    if (params.warehouseId) {
      await tx
        .delete(projectWarehouseAssignments)
        .where(
          and(
            eq(projectWarehouseAssignments.projectId, params.projectId),
            eq(projectWarehouseAssignments.warehouseId, params.warehouseId)
          )
        );
    } else {
      await tx
        .delete(projectWarehouseAssignments)
        .where(eq(projectWarehouseAssignments.projectId, params.projectId));
    }

    const removedPrimary =
      !params.warehouseId || params.warehouseId === project.warehouseId;
    if (removedPrimary) {
      const [nextAssignment] = await tx
        .select()
        .from(projectWarehouseAssignments)
        .where(eq(projectWarehouseAssignments.projectId, params.projectId))
        .orderBy(asc(projectWarehouseAssignments.id))
        .limit(1);

      nextPrimaryWarehouseId = nextAssignment?.warehouseId ?? null;
      if (nextPrimaryWarehouseId) {
        await tx
          .update(projectWarehouseAssignments)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(eq(projectWarehouseAssignments.projectId, params.projectId));
        await tx
          .update(projectWarehouseAssignments)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(projectWarehouseAssignments.id, nextAssignment.id));
      }
      await tx
        .update(projects)
        .set({ warehouseId: nextPrimaryWarehouseId, updatedAt: new Date() })
        .where(eq(projects.id, params.projectId));
    }
  });

  const syncResult =
    !nextPrimaryWarehouseId && !params.warehouseId
      ? await syncInventoryItemsToAssignedWarehouse(params.projectId, null)
      : { linkedRows: 0 };

  return { success: true, linkedRows: syncResult.linkedRows };
}

export async function listUnassignedProjects(statusFilter = "activo") {
  const db = await getDb();
  if (!db) return [];

  const conditions = [
    sql`not exists (
      select 1
      from ${projectWarehouseAssignments}
      where ${projectWarehouseAssignments.projectId} = ${projects.id}
    )`,
  ];
  if (statusFilter) {
    conditions.push(eq(projects.status, statusFilter as any));
  }

  return db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(asc(projects.code), asc(projects.name));
}

export async function listWarehouseAssignableUsers() {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(users)
    .where(inArray(users.buildreqRole, WAREHOUSE_ASSIGNABLE_ROLES))
    .orderBy(asc(users.name), asc(users.email));
  const hydratedRows = await hydrateUsersWithAssignedProjects(rows);

  return hydratedRows.map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    buildreqRole: user.buildreqRole,
    assignedProjectId: user.assignedProjectId,
    assignedProjectIds: user.assignedProjectIds,
    assignedProjects: user.assignedProjects,
  }));
}

export async function assignUserToWarehouse(params: {
  warehouseId: number;
  userId: number;
  isResponsible?: boolean;
  assignedById?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const warehouse = await getWarehouseById(params.warehouseId);
  if (!warehouse) throw new Error("Almacén no encontrado");
  if (!warehouse.isActive) {
    throw new Error("No se puede asignar usuarios a una bodega inactiva");
  }

  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);

  if (!targetUser) throw new Error("Usuario no encontrado");
  if (!isWarehouseAssignableUser(targetUser)) {
    throw new Error(
      "Solo usuarios de Administración Central, Bodega Central, Administración Proyecto o Bodega Proyecto pueden asignarse a bodegas"
    );
  }

  await db.transaction(async tx => {
    if (params.isResponsible) {
      await tx
        .update(warehouseUserAssignments)
        .set({ isResponsible: false, updatedAt: new Date() })
        .where(eq(warehouseUserAssignments.warehouseId, params.warehouseId));
    }

    const [existing] = await tx
      .select()
      .from(warehouseUserAssignments)
      .where(
        and(
          eq(warehouseUserAssignments.warehouseId, params.warehouseId),
          eq(warehouseUserAssignments.userId, params.userId)
        )
      )
      .limit(1);

    if (existing) {
      await tx
        .update(warehouseUserAssignments)
        .set({
          isResponsible: params.isResponsible ? true : existing.isResponsible,
          assignmentSource: WAREHOUSE_ASSIGNMENT_SOURCE_MANUAL,
          assignedById: params.assignedById ?? existing.assignedById,
          updatedAt: new Date(),
        })
        .where(eq(warehouseUserAssignments.id, existing.id));
      return;
    }

    await tx.insert(warehouseUserAssignments).values({
      warehouseId: params.warehouseId,
      userId: params.userId,
      isResponsible: Boolean(params.isResponsible),
      assignmentSource: WAREHOUSE_ASSIGNMENT_SOURCE_MANUAL,
      assignedById: params.assignedById ?? null,
    });
  });

  return { success: true };
}

export async function setWarehouseResponsible(params: {
  warehouseId: number;
  userId: number;
  assignedById?: number | null;
}) {
  return assignUserToWarehouse({
    ...params,
    isResponsible: true,
  });
}

export async function unassignUserFromWarehouse(params: {
  warehouseId: number;
  userId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .delete(warehouseUserAssignments)
    .where(
      and(
        eq(warehouseUserAssignments.warehouseId, params.warehouseId),
        eq(warehouseUserAssignments.userId, params.userId)
      )
    );

  return { success: true };
}

// ============================================================
// INVENTORY ITEMS
// ============================================================
export type InventorySortField =
  | "sapItemCode"
  | "name"
  | "brand"
  | "partNumber"
  | "category"
  | "unit"
  | "currentStock"
  | "minimumStock"
  | "warehouseLocation"
  | "projectName";

export type InventoryListFilters = {
  category?: string;
  search?: string;
  isActive?: boolean;
  warehouseId?: number;
  warehouseIds?: number[];
  projectId?: number;
  projectIds?: number[];
  unclassifiedOnly?: boolean;
  page?: number;
  pageSize?: number;
  includePendingQuantities?: boolean;
  sortBy?: InventorySortField;
  sortDir?: "asc" | "desc";
};

function buildInventorySearchTerms(search: string) {
  const trimmedSearch = search.trim();
  const terms = new Set<string>();
  if (trimmedSearch) terms.add(trimmedSearch);

  if (trimmedSearch.length >= 5 && !/^\d+$/.test(trimmedSearch)) {
    terms.add(trimmedSearch.slice(0, -1));
  }

  return Array.from(terms);
}

function buildInventoryWhere(filters?: InventoryListFilters) {
  const conditions = [];
  if (filters?.category)
    conditions.push(eq(inventoryItems.category, filters.category));
  if (filters?.isActive !== undefined)
    conditions.push(eq(inventoryItems.isActive, filters.isActive));
  if (filters?.warehouseId)
    conditions.push(eq(inventoryItems.warehouseId, filters.warehouseId));
  if (filters?.warehouseIds) {
    conditions.push(
      filters.warehouseIds.length > 0
        ? inArray(inventoryItems.warehouseId, filters.warehouseIds)
        : sql`false`
    );
  }
  if (filters?.projectId)
    conditions.push(eq(inventoryItems.projectId, filters.projectId));
  if (filters?.projectIds) {
    applyProjectScope(conditions, inventoryItems.projectId, filters.projectIds);
  }
  if (filters?.unclassifiedOnly) {
    conditions.push(sql`${inventoryItems.projectId} IS NULL`);
    conditions.push(sql`${inventoryItems.currentStock}::numeric > 0`);
  } else {
    conditions.push(sql`${inventoryItems.projectId} IS NOT NULL`);
  }
  if (filters?.search) {
    const searchConditions = buildInventorySearchTerms(filters.search).flatMap(
      search => [
        ilike(inventoryItems.name, `%${search}%`),
        ilike(inventoryItems.sapItemCode, `%${search}%`),
        ilike(inventoryItems.description, `%${search}%`),
        ilike(inventoryItems.category, `%${search}%`),
        ilike(inventoryItems.unit, `%${search}%`),
        ilike(sapCatalog.description, `%${search}%`),
        ilike(inventoryItems.warehouseLocation, `%${search}%`),
        ilike(sapCatalog.brand, `%${search}%`),
        ilike(sapCatalog.partNumber, `%${search}%`),
        ilike(warehouses.code, `%${search}%`),
        ilike(warehouses.name, `%${search}%`),
        ilike(warehouses.displayName, `%${search}%`),
        ilike(projects.code, `%${search}%`),
        ilike(projects.name, `%${search}%`),
      ]
    );

    conditions.push(or(...searchConditions)!);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function getInventoryIdsByFilters(filters?: InventoryListFilters) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .leftJoin(sapCatalog, eq(inventoryItems.sapItemCode, sapCatalog.itemCode))
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(buildInventoryWhere(filters));

  return rows.map(row => row.id);
}

function getInventoryPendingScopeKey(item: any) {
  return [
    item.sapItemCode,
    item.project?.id ?? "no-project",
    item.warehouse?.id ??
      item.warehouseId ??
      item.warehouseLocation ??
      "no-warehouse",
  ].join("::");
}

async function getPendingQuantitiesForInventoryItems(items: any[]) {
  const pendingQuantityByScope = new Map<
    string,
    { totalRequiredQuantity: string; pendingReceiptQuantity: string }
  >();
  const pendingQuantityParamsByScope = new Map<
    string,
    {
      sapItemCode: string;
      projectId: number | null;
      warehouseId: number | null;
      warehouseLocation: string | null;
    }
  >();

  for (const item of items) {
    const scopeKey = getInventoryPendingScopeKey(item);
    if (pendingQuantityParamsByScope.has(scopeKey)) continue;
    pendingQuantityParamsByScope.set(scopeKey, {
      sapItemCode: item.sapItemCode,
      projectId: item.project?.id ?? null,
      warehouseId: item.warehouse?.id ?? item.warehouseId ?? null,
      warehouseLocation: item.warehouseLocation ?? null,
    });
  }

  for (const [scopeKey, params] of Array.from(
    pendingQuantityParamsByScope.entries()
  )) {
    pendingQuantityByScope.set(
      scopeKey,
      await getInventoryPendingProcessQuantities(params)
    );
  }

  return pendingQuantityByScope;
}

export async function getInventoryPendingQuantitiesByItemIds(
  ids: number[],
  filters?: Pick<
    InventoryListFilters,
    "projectId" | "projectIds" | "warehouseId" | "warehouseIds"
  >
) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];

  const uniqueIds = Array.from(
    new Set(ids.filter(id => Number.isInteger(id) && id > 0))
  );
  if (uniqueIds.length === 0) return [];

  const conditions = [inArray(inventoryItems.id, uniqueIds)];
  if (filters?.warehouseId) {
    conditions.push(eq(inventoryItems.warehouseId, filters.warehouseId));
  }
  if (filters?.warehouseIds !== undefined) {
    conditions.push(
      filters.warehouseIds.length > 0
        ? inArray(inventoryItems.warehouseId, filters.warehouseIds)
        : sql`false`
    );
  }
  if (filters?.projectId) {
    conditions.push(eq(inventoryItems.projectId, filters.projectId));
  }
  if (filters?.projectIds !== undefined) {
    applyProjectScope(conditions, inventoryItems.projectId, filters.projectIds);
  }

  const rows = await db
    .select({
      item: inventoryItems,
      warehouse: warehouses,
      project: projects,
    })
    .from(inventoryItems)
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(and(...conditions));

  const items = rows.map(({ item, warehouse, project }) => ({
    ...item,
    warehouse: warehouse
      ? {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          displayName: warehouse.displayName,
        }
      : null,
    project: project
      ? {
          id: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
        }
      : null,
    warehouseLocation: warehouse?.displayName ?? item.warehouseLocation,
  }));

  const pendingQuantityByScope =
    await getPendingQuantitiesForInventoryItems(items);

  return items.map(item => {
    const pendingQuantity = pendingQuantityByScope.get(
      getInventoryPendingScopeKey(item)
    );
    return {
      id: item.id,
      totalRequiredQuantity: pendingQuantity?.totalRequiredQuantity ?? "0.00",
      pendingReceiptQuantity: pendingQuantity?.pendingReceiptQuantity ?? "0.00",
    };
  });
}

export async function listInventoryItems(filters?: InventoryListFilters) {
  const db = await getDb();
  const requestedPage = Math.max(filters?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters?.pageSize ?? 25, 10), 200);
  const includePendingQuantities = filters?.includePendingQuantities ?? true;
  const sortBy = filters?.sortBy ?? "name";
  const sortDir = filters?.sortDir ?? "asc";

  if (!db) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize,
      totalPages: 1,
      sortBy,
      sortDir,
    };
  }

  const where = buildInventoryWhere(filters);
  const [totalResult] = await db
    .select({ count: count() })
    .from(inventoryItems)
    .leftJoin(sapCatalog, eq(inventoryItems.sapItemCode, sapCatalog.itemCode))
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(where);

  const total = totalResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const sortColumn = (() => {
    switch (sortBy) {
      case "sapItemCode":
        return inventoryItems.sapItemCode;
      case "category":
        return inventoryItems.category;
      case "brand":
        return sapCatalog.brand;
      case "partNumber":
        return sapCatalog.partNumber;
      case "unit":
        return inventoryItems.unit;
      case "currentStock":
        return inventoryItems.currentStock;
      case "minimumStock":
        return inventoryItems.minimumStock;
      case "warehouseLocation":
        return sql<string>`coalesce(${warehouses.displayName}, ${inventoryItems.warehouseLocation})`;
      case "projectName":
        return sql<string>`coalesce(${projects.name}, 'Por clasificar')`;
      case "name":
      default:
        return inventoryItems.name;
    }
  })();
  const primaryOrder = sortDir === "desc" ? desc(sortColumn) : asc(sortColumn);
  const secondaryOrder =
    sortBy === "name" && sortDir === "asc"
      ? asc(inventoryItems.id)
      : desc(inventoryItems.id);

  const rows = await db
    .select({
      item: inventoryItems,
      catalog: sapCatalog,
      warehouse: warehouses,
      project: projects,
    })
    .from(inventoryItems)
    .leftJoin(sapCatalog, eq(inventoryItems.sapItemCode, sapCatalog.itemCode))
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(where)
    .orderBy(primaryOrder, secondaryOrder)
    .limit(pageSize)
    .offset(offset);

  const items = rows.map(({ item, catalog, warehouse, project }) => ({
    ...item,
    brand: catalog?.brand ?? null,
    partNumber: catalog?.partNumber ?? null,
    catalogItem: catalog
      ? {
          id: catalog.id,
          itemCode: catalog.itemCode,
          description: catalog.description,
          itemGroup: catalog.itemGroup,
          brand: catalog.brand,
          partNumber: catalog.partNumber,
          tipoArticulo: catalog.tipoArticulo,
        }
      : null,
    warehouse: warehouse
      ? {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          displayName: warehouse.displayName,
        }
      : null,
    project: project
      ? {
          id: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
        }
      : null,
    warehouseLocation: warehouse?.displayName ?? item.warehouseLocation,
  }));

  const pendingQuantityByScope = includePendingQuantities
    ? await getPendingQuantitiesForInventoryItems(items)
    : new Map<
        string,
        { totalRequiredQuantity: string; pendingReceiptQuantity: string }
      >();

  return {
    items: items.map(item => ({
      ...item,
      totalRequiredQuantity:
        pendingQuantityByScope.get(getInventoryPendingScopeKey(item))
          ?.totalRequiredQuantity ?? "0.00",
      pendingReceiptQuantity:
        pendingQuantityByScope.get(getInventoryPendingScopeKey(item))
          ?.pendingReceiptQuantity ?? "0.00",
    })),
    total,
    page,
    pageSize,
    totalPages,
    sortBy,
    sortDir,
  };
}

export async function searchGlobalInventoryAvailability(params?: {
  search?: string | null;
  limit?: number | null;
}) {
  const db = await getDb();
  if (!db) return [];

  const search = params?.search?.trim() ?? "";
  if (search.length < 2) return [];

  const limit = Math.min(Math.max(params?.limit ?? 75, 1), 150);
  const conditions = [
    eq(inventoryItems.isActive, true),
    sql`${inventoryItems.projectId} IS NOT NULL`,
    sql`${inventoryItems.currentStock}::numeric > 0`,
    or(
      ilike(inventoryItems.sapItemCode, `%${search}%`),
      ilike(inventoryItems.name, `%${search}%`),
      ilike(inventoryItems.description, `%${search}%`),
      ilike(inventoryItems.category, `%${search}%`),
      ilike(sapCatalog.description, `%${search}%`),
      ilike(sapCatalog.brand, `%${search}%`),
      ilike(sapCatalog.partNumber, `%${search}%`),
      ilike(warehouses.code, `%${search}%`),
      ilike(warehouses.name, `%${search}%`),
      ilike(warehouses.displayName, `%${search}%`),
      ilike(projects.code, `%${search}%`),
      ilike(projects.name, `%${search}%`)
    )!,
  ];

  const rows = await db
    .select({
      sapItemCode: inventoryItems.sapItemCode,
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
      category: inventoryItems.category,
      brand: sapCatalog.brand,
      partNumber: sapCatalog.partNumber,
      warehouseId: warehouses.id,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      warehouseDisplayName: warehouses.displayName,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      quantity: sql<string>`coalesce(sum(${inventoryItems.currentStock}), 0)`,
    })
    .from(inventoryItems)
    .leftJoin(sapCatalog, eq(inventoryItems.sapItemCode, sapCatalog.itemCode))
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(and(...conditions))
    .groupBy(
      inventoryItems.sapItemCode,
      inventoryItems.name,
      inventoryItems.unit,
      inventoryItems.category,
      sapCatalog.brand,
      sapCatalog.partNumber,
      warehouses.id,
      warehouses.code,
      warehouses.name,
      warehouses.displayName,
      projects.id,
      projects.code,
      projects.name
    )
    .orderBy(asc(inventoryItems.name), asc(warehouses.displayName))
    .limit(limit);

  return rows.map(row => ({
    sapItemCode: row.sapItemCode,
    itemName: row.itemName,
    unit: row.unit,
    category: row.category,
    brand: row.brand,
    partNumber: row.partNumber,
    quantity: toDecimalString(row.quantity),
    warehouse: row.warehouseId
      ? {
          id: row.warehouseId,
          code: row.warehouseCode,
          name: row.warehouseName,
          displayName: row.warehouseDisplayName,
        }
      : null,
    project: row.projectId
      ? {
          id: row.projectId,
          code: row.projectCode,
          name: row.projectName,
        }
      : null,
  }));
}

async function resolveInventoryScopeProjectIds(params: {
  projectId?: number | null;
  projectIds?: number[] | null;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  if (!db) return null;
  if (Array.isArray(params.projectIds)) return params.projectIds;
  if (params.projectId) return [params.projectId];

  const conditions = [];
  if (params.warehouseId) {
    conditions.push(eq(warehouses.id, params.warehouseId));
  } else if (params.warehouseLocation?.trim()) {
    const warehouseLocation = params.warehouseLocation.trim();
    conditions.push(
      or(
        eq(warehouses.displayName, warehouseLocation),
        eq(warehouses.name, warehouseLocation)
      )!
    );
  } else {
    return null;
  }

  const warehouseRows = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(...conditions));
  const warehouseIds = warehouseRows.map(row => row.id);
  if (warehouseIds.length === 0) return [];

  const rows = await db
    .select({ projectId: projectWarehouseAssignments.projectId })
    .from(projectWarehouseAssignments)
    .where(inArray(projectWarehouseAssignments.warehouseId, warehouseIds));

  return rows
    .map(row => row.projectId)
    .filter((projectId): projectId is number => typeof projectId === "number");
}

function applyProjectScope(
  conditions: any[],
  projectColumn: any,
  projectIds: number[] | null
) {
  if (projectIds === null) return;
  if (projectIds.length === 0) {
    conditions.push(sql`1 = 0`);
    return;
  }
  conditions.push(inArray(projectColumn, projectIds));
}

async function getInventoryPendingProcessQuantities(params: {
  sapItemCode: string;
  projectId?: number | null;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  const sapItemCode = params.sapItemCode.trim();
  if (!db || !sapItemCode) {
    return {
      totalRequiredQuantity: "0.00",
      pendingReceiptQuantity: "0.00",
    };
  }
  const scopeProjectIds = await resolveInventoryScopeProjectIds(params);

  const materialConditions = [
    eq(requestItems.sapItemCode, sapItemCode),
    sql`${materialRequests.status}::text IN ('pendiente_aprobar', 'en_espera', 'en_proceso', 'parcialmente_atendida')`,
    sql`${requestItems.status} <> 'completo'`,
  ];
  applyProjectScope(
    materialConditions,
    materialRequests.projectId,
    scopeProjectIds
  );

  const purchaseRequestConditions = [
    or(
      eq(purchaseRequestItems.currentSapItemCode, sapItemCode),
      eq(purchaseRequestItems.originalSapItemCode, sapItemCode)
    )!,
    inArray(purchaseRequests.status, [
      "pendiente",
      "en_revision",
      "aprobada",
      "parcialmente_convertida",
    ]),
  ];
  applyProjectScope(
    purchaseRequestConditions,
    purchaseRequests.projectId,
    scopeProjectIds
  );

  const purchaseOrderConditions = [
    or(
      eq(purchaseOrderItems.currentSapItemCode, sapItemCode),
      eq(purchaseOrderItems.originalSapItemCode, sapItemCode)
    )!,
    inArray(purchaseOrders.status, [
      "borrador",
      "emitida",
      "enviada",
      "parcialmente_recibida",
    ]),
    eq(purchaseOrderItems.receiptClosed, false),
  ];
  applyProjectScope(
    purchaseOrderConditions,
    purchaseOrders.projectId,
    scopeProjectIds
  );

  const [materialRows, purchaseRequestRows, purchaseOrderRows] =
    await Promise.all([
      db
        .select({
          quantity: requestItems.quantity,
          deliveredQuantity: requestItems.deliveredQuantity,
        })
        .from(requestItems)
        .innerJoin(
          materialRequests,
          eq(requestItems.requestId, materialRequests.id)
        )
        .where(and(...materialConditions)),
      db
        .select({
          quantity: purchaseRequestItems.quantity,
          receivedQuantity: purchaseRequestItems.receivedQuantity,
        })
        .from(purchaseRequestItems)
        .innerJoin(
          purchaseRequests,
          eq(purchaseRequestItems.purchaseRequestId, purchaseRequests.id)
        )
        .where(and(...purchaseRequestConditions)),
      db
        .select({
          quantity: purchaseOrderItems.quantity,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
        .from(purchaseOrderItems)
        .innerJoin(
          purchaseOrders,
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)
        )
        .where(and(...purchaseOrderConditions)),
    ]);

  const totalRequiredQuantity = materialRows
    .map(row =>
      Math.max(
        parseDecimal(row.quantity) - parseDecimal(row.deliveredQuantity),
        0
      )
    )
    .reduce((sum, value) => sum + value, 0);
  const pendingReceiptQuantity = [
    ...purchaseRequestRows.map(row =>
      Math.max(
        parseDecimal(row.quantity) - parseDecimal(row.receivedQuantity),
        0
      )
    ),
    ...purchaseOrderRows.map(row =>
      Math.max(
        parseDecimal(row.quantity) - parseDecimal(row.receivedQuantity),
        0
      )
    ),
  ].reduce((sum, value) => sum + value, 0);

  return {
    totalRequiredQuantity: toDecimalString(totalRequiredQuantity),
    pendingReceiptQuantity: toDecimalString(pendingReceiptQuantity),
  };
}

export async function getInventoryTracking(params: {
  sapItemCode: string;
  projectId?: number | null;
  projectIds?: number[] | null;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  const sapItemCode = params.sapItemCode.trim();
  if (!db || !sapItemCode) {
    return {
      materialRequests: [],
      purchaseRequests: [],
      purchaseOrders: [],
    };
  }
  const scopeProjectIds = await resolveInventoryScopeProjectIds(params);

  const materialConditions = [
    eq(requestItems.sapItemCode, sapItemCode),
    sql`${materialRequests.status}::text IN ('pendiente_aprobar', 'en_espera', 'en_proceso', 'parcialmente_atendida')`,
    sql`${requestItems.status} <> 'completo'`,
  ];
  applyProjectScope(
    materialConditions,
    materialRequests.projectId,
    scopeProjectIds
  );

  const purchaseRequestConditions = [
    or(
      eq(purchaseRequestItems.currentSapItemCode, sapItemCode),
      eq(purchaseRequestItems.originalSapItemCode, sapItemCode)
    )!,
    inArray(purchaseRequests.status, [
      "pendiente",
      "en_revision",
      "aprobada",
      "parcialmente_convertida",
    ]),
  ];
  applyProjectScope(
    purchaseRequestConditions,
    purchaseRequests.projectId,
    scopeProjectIds
  );

  const purchaseOrderConditions = [
    or(
      eq(purchaseOrderItems.currentSapItemCode, sapItemCode),
      eq(purchaseOrderItems.originalSapItemCode, sapItemCode)
    )!,
    inArray(purchaseOrders.status, [
      "borrador",
      "emitida",
      "enviada",
      "parcialmente_recibida",
    ]),
    eq(purchaseOrderItems.receiptClosed, false),
  ];
  applyProjectScope(
    purchaseOrderConditions,
    purchaseOrders.projectId,
    scopeProjectIds
  );

  const [materialRows, purchaseRequestRows, purchaseOrderRows] =
    await Promise.all([
      db
        .select({
          request: materialRequests,
          item: requestItems,
          project: projects,
        })
        .from(requestItems)
        .innerJoin(
          materialRequests,
          eq(requestItems.requestId, materialRequests.id)
        )
        .leftJoin(projects, eq(materialRequests.projectId, projects.id))
        .where(and(...materialConditions))
        .orderBy(desc(materialRequests.createdAt), desc(requestItems.id))
        .limit(50),
      db
        .select({
          purchaseRequest: purchaseRequests,
          item: purchaseRequestItems,
          project: projects,
        })
        .from(purchaseRequestItems)
        .innerJoin(
          purchaseRequests,
          eq(purchaseRequestItems.purchaseRequestId, purchaseRequests.id)
        )
        .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
        .where(and(...purchaseRequestConditions))
        .orderBy(
          desc(purchaseRequests.createdAt),
          desc(purchaseRequestItems.id)
        )
        .limit(50),
      db
        .select({
          purchaseOrder: purchaseOrders,
          item: purchaseOrderItems,
          project: projects,
          supplier: suppliers,
        })
        .from(purchaseOrderItems)
        .innerJoin(
          purchaseOrders,
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)
        )
        .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(and(...purchaseOrderConditions))
        .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrderItems.id))
        .limit(50),
    ]);

  return {
    materialRequests: materialRows.map(({ request, item, project }) => {
      const pendingQuantity = Math.max(
        parseDecimal(item.quantity) - parseDecimal(item.deliveredQuantity),
        0
      );
      return {
        id: item.id,
        documentId: request.id,
        documentNumber: request.requestNumber,
        status: request.status,
        workflowStage: request.workflowStage,
        project,
        itemName: item.sapItemDescription || item.itemName,
        quantity: toDecimalString(item.quantity),
        pendingQuantity: toDecimalString(pendingQuantity),
        unit: item.unit,
        neededBy: request.neededBy,
        updatedAt: item.updatedAt,
      };
    }),
    purchaseRequests: purchaseRequestRows.map(
      ({ purchaseRequest, item, project }) => {
        const pendingQuantity = Math.max(
          parseDecimal(item.quantity) - parseDecimal(item.receivedQuantity),
          0
        );
        return {
          id: item.id,
          documentId: purchaseRequest.id,
          documentNumber: purchaseRequest.requestNumber,
          status: purchaseRequest.status,
          project,
          itemName: item.itemName,
          quantity: toDecimalString(item.quantity),
          pendingQuantity: toDecimalString(pendingQuantity),
          unit: item.unit,
          neededBy: purchaseRequest.neededBy,
          updatedAt: item.updatedAt,
        };
      }
    ),
    purchaseOrders: purchaseOrderRows.map(
      ({ purchaseOrder, item, project, supplier }) => {
        const pendingQuantity = Math.max(
          parseDecimal(item.quantity) - parseDecimal(item.receivedQuantity),
          0
        );
        return {
          id: item.id,
          documentId: purchaseOrder.id,
          documentNumber: purchaseOrder.orderNumber,
          status: purchaseOrder.status,
          classification: purchaseOrder.classification,
          project,
          supplierName: supplier?.name ?? null,
          itemName: item.itemName,
          quantity: toDecimalString(item.quantity),
          receivedQuantity: toDecimalString(item.receivedQuantity),
          pendingQuantity: toDecimalString(pendingQuantity),
          unit: item.unit,
          neededBy: purchaseOrder.neededBy,
          updatedAt: item.updatedAt,
        };
      }
    ),
  };
}

export async function getInventoryKardex(params: {
  sapItemCode: string;
  projectId?: number | null;
  projectIds?: number[] | null;
  warehouseId?: number | null;
  warehouseLocation?: string | null;
}) {
  const db = await getDb();
  const sapItemCode = params.sapItemCode.trim();
  if (!db || !sapItemCode) {
    return {
      balances: [],
      movements: [],
    };
  }
  const scopeProjectIds = await resolveInventoryScopeProjectIds(params);

  const balanceConditions = [eq(inventoryItems.sapItemCode, sapItemCode)];
  applyProjectScope(
    balanceConditions,
    inventoryItems.projectId,
    scopeProjectIds
  );
  if (params.warehouseId) {
    balanceConditions.push(eq(inventoryItems.warehouseId, params.warehouseId));
  }

  const openingConditions = [eq(openingBalanceItems.sapItemCode, sapItemCode)];
  applyProjectScope(
    openingConditions,
    openingBalances.projectId,
    scopeProjectIds
  );
  if (params.warehouseId) {
    openingConditions.push(eq(openingBalances.warehouseId, params.warehouseId));
  }

  const purchaseReceiptConditions = [
    eq(receipts.sourceType, "purchase_order"),
    or(
      eq(purchaseOrderItems.currentSapItemCode, sapItemCode),
      eq(purchaseOrderItems.originalSapItemCode, sapItemCode)
    )!,
  ];
  applyProjectScope(
    purchaseReceiptConditions,
    receipts.projectId,
    scopeProjectIds
  );
  if (params.warehouseId) {
    purchaseReceiptConditions.push(
      eq(receiptItems.warehouseId, params.warehouseId)
    );
  }

  const transferReceiptConditions = [
    eq(receipts.sourceType, "transfer"),
    eq(transferRequestItems.sapItemCode, sapItemCode),
  ];
  applyProjectScope(
    transferReceiptConditions,
    receipts.projectId,
    scopeProjectIds
  );
  if (params.warehouseId) {
    transferReceiptConditions.push(
      eq(receiptItems.warehouseId, params.warehouseId)
    );
  }

  const warehouseExitConditions = [
    eq(warehouseExitItems.sapItemCode, sapItemCode),
    eq(warehouseExits.status, "emitida"),
  ];
  applyProjectScope(
    warehouseExitConditions,
    warehouseExits.projectId,
    scopeProjectIds
  );
  if (params.warehouseId) {
    warehouseExitConditions.push(
      eq(warehouseExits.warehouseId, params.warehouseId)
    );
  }

  const transferExitConditions = [
    eq(transferRequestItems.sapItemCode, sapItemCode),
    sql`${transfers.status} <> 'anulado'`,
  ];
  applyProjectScope(
    transferExitConditions,
    transferRequests.projectId,
    scopeProjectIds
  );
  if (params.warehouseId) {
    transferExitConditions.push(
      eq(transferRequestItems.sourceWarehouseId, params.warehouseId)
    );
  }

  const [
    balanceRows,
    openingRows,
    purchaseReceiptRows,
    transferReceiptRows,
    warehouseExitRows,
    transferExitRows,
  ] = await Promise.all([
    db
      .select({
        item: inventoryItems,
        warehouse: warehouses,
        project: projects,
      })
      .from(inventoryItems)
      .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
      .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
      .where(and(...balanceConditions))
      .orderBy(
        asc(projects.code),
        asc(warehouses.displayName),
        asc(inventoryItems.id)
      ),
    db
      .select({
        openingBalance: openingBalances,
        item: openingBalanceItems,
        project: projects,
        warehouse: warehouses,
      })
      .from(openingBalanceItems)
      .innerJoin(
        openingBalances,
        eq(openingBalanceItems.openingBalanceId, openingBalances.id)
      )
      .leftJoin(projects, eq(openingBalances.projectId, projects.id))
      .leftJoin(warehouses, eq(openingBalances.warehouseId, warehouses.id))
      .where(and(...openingConditions))
      .orderBy(desc(openingBalances.openingDate), desc(openingBalanceItems.id))
      .limit(50),
    db
      .select({
        receipt: receipts,
        receiptItem: receiptItems,
        sourceItem: purchaseOrderItems,
        purchaseOrder: purchaseOrders,
        project: projects,
        warehouse: warehouses,
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .innerJoin(
        purchaseOrderItems,
        eq(receiptItems.sourceItemId, purchaseOrderItems.id)
      )
      .leftJoin(purchaseOrders, eq(receipts.sourceId, purchaseOrders.id))
      .leftJoin(projects, eq(receipts.projectId, projects.id))
      .leftJoin(warehouses, eq(receiptItems.warehouseId, warehouses.id))
      .where(and(...purchaseReceiptConditions))
      .orderBy(desc(receipts.receiptDate), desc(receiptItems.id))
      .limit(75),
    db
      .select({
        receipt: receipts,
        receiptItem: receiptItems,
        sourceItem: transferRequestItems,
        transfer: transfers,
        project: projects,
        warehouse: warehouses,
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .innerJoin(
        transferRequestItems,
        eq(receiptItems.sourceItemId, transferRequestItems.id)
      )
      .leftJoin(transfers, eq(receipts.sourceId, transfers.id))
      .leftJoin(projects, eq(receipts.projectId, projects.id))
      .leftJoin(warehouses, eq(receiptItems.warehouseId, warehouses.id))
      .where(and(...transferReceiptConditions))
      .orderBy(desc(receipts.receiptDate), desc(receiptItems.id))
      .limit(75),
    db
      .select({
        warehouseExit: warehouseExits,
        item: warehouseExitItems,
        project: projects,
        warehouse: warehouses,
      })
      .from(warehouseExitItems)
      .innerJoin(
        warehouseExits,
        eq(warehouseExitItems.warehouseExitId, warehouseExits.id)
      )
      .leftJoin(projects, eq(warehouseExits.projectId, projects.id))
      .leftJoin(warehouses, eq(warehouseExits.warehouseId, warehouses.id))
      .where(and(...warehouseExitConditions))
      .orderBy(desc(warehouseExits.exitDate), desc(warehouseExitItems.id))
      .limit(75),
    db
      .select({
        transfer: transfers,
        transferRequest: transferRequests,
        item: transferRequestItems,
        project: projects,
        warehouse: warehouses,
      })
      .from(transferRequestItems)
      .innerJoin(
        transferRequests,
        eq(transferRequestItems.transferRequestId, transferRequests.id)
      )
      .innerJoin(
        transfers,
        eq(transfers.transferRequestId, transferRequests.id)
      )
      .leftJoin(projects, eq(transferRequests.projectId, projects.id))
      .leftJoin(
        warehouses,
        eq(transferRequestItems.sourceWarehouseId, warehouses.id)
      )
      .where(and(...transferExitConditions))
      .orderBy(desc(transfers.createdAt), desc(transferRequestItems.id))
      .limit(75),
  ]);

  const balances = balanceRows.map(({ item, warehouse, project }) => ({
    id: item.id,
    sapItemCode: item.sapItemCode,
    itemName: item.name,
    unit: item.unit,
    currentStock: toDecimalString(item.currentStock),
    project,
    warehouse: warehouse
      ? {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          displayName: warehouse.displayName,
        }
      : null,
    warehouseLocation: warehouse?.displayName ?? item.warehouseLocation,
    updatedAt: item.updatedAt,
  }));

  const movements = [
    ...openingRows.map(({ openingBalance, item, project, warehouse }) => ({
      id: `opening-${item.id}`,
      type: "saldo_inicial" as const,
      direction: "entrada" as const,
      documentNumber: openingBalance.balanceNumber,
      sourceNumber: null as string | null,
      date: openingBalance.openingDate,
      project,
      warehouse: warehouse
        ? {
            id: warehouse.id,
            code: warehouse.code,
            name: warehouse.name,
            displayName: warehouse.displayName,
          }
        : null,
      itemName: item.itemName,
      quantity: toDecimalString(item.quantity),
      unit: item.unit,
      notes: item.notes,
    })),
    ...purchaseReceiptRows.map(
      ({
        receipt,
        receiptItem,
        sourceItem,
        purchaseOrder,
        project,
        warehouse,
      }) => ({
        id: `receipt-po-${receiptItem.id}`,
        type: "recepcion_oc" as const,
        direction: "entrada" as const,
        documentNumber: receipt.receiptNumber,
        sourceNumber: purchaseOrder?.orderNumber ?? null,
        date: receipt.receiptDate,
        project,
        warehouse: warehouse ? mapWarehouseSummary(warehouse) : null,
        itemName: sourceItem.itemName,
        quantity: toDecimalString(receiptItem.quantityReceived),
        unit: sourceItem.unit ?? receiptItem.unit,
        notes: receipt.notes,
      })
    ),
    ...transferReceiptRows.map(
      ({ receipt, receiptItem, sourceItem, transfer, project, warehouse }) => ({
        id: `receipt-transfer-${receiptItem.id}`,
        type: "recepcion_traslado" as const,
        direction: "entrada" as const,
        documentNumber: receipt.receiptNumber,
        sourceNumber: transfer?.transferNumber ?? null,
        date: receipt.receiptDate,
        project,
        warehouse: warehouse ? mapWarehouseSummary(warehouse) : null,
        itemName: sourceItem.itemName,
        quantity: toDecimalString(receiptItem.quantityReceived),
        unit: sourceItem.unit ?? receiptItem.unit,
        notes: receipt.notes,
      })
    ),
    ...warehouseExitRows.map(({ warehouseExit, item, project, warehouse }) => ({
      id: `warehouse-exit-${item.id}`,
      type: "despacho_bodega" as const,
      direction: "salida" as const,
      documentNumber: warehouseExit.exitNumber,
      sourceNumber: null as string | null,
      date: warehouseExit.exitDate,
      project,
      warehouse: warehouse
        ? {
            id: warehouse.id,
            code: warehouse.code,
            name: warehouse.name,
            displayName: warehouse.displayName,
          }
        : null,
      itemName: item.itemName,
      quantity: toDecimalString(item.quantity),
      unit: item.unit,
      notes: item.notes ?? warehouseExit.notes,
    })),
    ...transferExitRows.map(
      ({ transfer, transferRequest, item, project, warehouse }) => ({
        id: `transfer-exit-${item.id}`,
        type: "salida_traslado" as const,
        direction: "salida" as const,
        documentNumber: transfer.transferNumber,
        sourceNumber: transferRequest.requestNumber,
        date: transfer.createdAt,
        project,
        warehouse: warehouse ? mapWarehouseSummary(warehouse) : null,
        itemName: item.itemName,
        quantity: toDecimalString(item.quantity),
        unit: item.unit,
        notes: transferRequest.notes,
      })
    ),
  ].sort((left, right) => {
    const leftTime = left.date ? new Date(left.date).getTime() : 0;
    const rightTime = right.date ? new Date(right.date).getTime() : 0;
    return rightTime - leftTime;
  });

  return {
    balances,
    movements,
  };
}

async function resolveProjectAssignment(
  projectId?: number | null,
  warehouseId?: number | null
) {
  if (!projectId) return null;

  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error("El proyecto seleccionado no existe");
  }

  const activeProjectWarehouses = await listProjectWarehouses(project.id, {
    isActive: true,
  });
  if (activeProjectWarehouses.length === 0) {
    throw new Error("El proyecto no tiene bodega asignada");
  }

  const selectedWarehouseId =
    warehouseId ?? project.warehouseId ?? activeProjectWarehouses[0]?.id;
  const warehouse = activeProjectWarehouses.find(
    projectWarehouse => projectWarehouse.id === selectedWarehouseId
  );
  if (!warehouse) {
    throw new Error("El almacén seleccionado no está asignado al proyecto");
  }

  return {
    projectId: project.id,
    warehouseId: warehouse.id,
    warehouseLocation: warehouse.displayName,
    warehouse,
  };
}

function getInventoryProjectIdForAssignment(
  projectAssignment:
    | Awaited<ReturnType<typeof resolveProjectAssignment>>
    | undefined
) {
  if (!projectAssignment) return null;
  return projectAssignment.projectId;
}

export async function createInventoryItem(data: InsertInventoryItem) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (!data.projectId) {
    throw new Error("Seleccione proyecto/bodega para crear inventario");
  }
  const projectAssignment = await resolveProjectAssignment(
    data.projectId,
    data.warehouseId
  );
  const warehouseAssignment = projectAssignment
    ? {
        warehouseId: projectAssignment.warehouseId,
        warehouseLocation: projectAssignment.warehouseLocation,
      }
    : await resolveWarehouseAssignment(
        data.warehouseId,
        data.warehouseLocation
      );
  const inventoryProjectId =
    getInventoryProjectIdForAssignment(projectAssignment);
  const [inventoryItem] = await db
    .insert(inventoryItems)
    .values({
      ...data,
      projectId: inventoryProjectId,
      warehouseId: warehouseAssignment.warehouseId,
      warehouseLocation: warehouseAssignment.warehouseLocation,
    })
    .returning({ id: inventoryItems.id });
  return { id: inventoryItem.id };
}

export async function updateInventoryItem(
  id: number,
  data: Partial<InsertInventoryItem>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [currentItem] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, id))
    .limit(1);
  if (!currentItem) {
    throw new Error("Ítem de inventario no encontrado");
  }
  const projectAssignment =
    data.projectId === undefined
      ? undefined
      : await resolveProjectAssignment(data.projectId, data.warehouseId);

  const nextData: Partial<InsertInventoryItem> = { ...data };
  if (data.projectId !== undefined) {
    nextData.projectId = getInventoryProjectIdForAssignment(projectAssignment);
    if (projectAssignment) {
      nextData.warehouseId = projectAssignment.warehouseId;
      nextData.warehouseLocation = projectAssignment.warehouseLocation;
    } else if (
      data.warehouseId === undefined &&
      data.warehouseLocation === undefined
    ) {
      nextData.warehouseId = null;
      nextData.warehouseLocation = null;
    }
  }
  if (
    data.projectId === undefined &&
    (data.warehouseId !== undefined || data.warehouseLocation !== undefined)
  ) {
    if (!currentItem.projectId) {
      throw new Error(
        "Clasifique el inventario en proyecto/bodega antes de cambiar su almacén"
      );
    }
    const warehouseAssignment = await resolveProjectAssignment(
      currentItem.projectId,
      data.warehouseId
    );
    nextData.projectId = warehouseAssignment?.projectId ?? currentItem.projectId;
    nextData.warehouseId = warehouseAssignment?.warehouseId ?? null;
    nextData.warehouseLocation = warehouseAssignment?.warehouseLocation ?? null;
  }

  await db
    .update(inventoryItems)
    .set(nextData)
    .where(eq(inventoryItems.id, id));
  return { success: true };
}

export async function bulkAssignInventoryProject(
  ids: number[],
  projectId: number,
  warehouseId: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (ids.length === 0) {
    throw new Error("Debe seleccionar al menos un ítem");
  }

  const projectAssignment = await resolveProjectAssignment(
    projectId,
    warehouseId
  );
  if (!projectAssignment) {
    throw new Error("Seleccione proyecto/bodega destino");
  }

  const result = await db
    .update(inventoryItems)
    .set({
      projectId: projectAssignment.projectId,
      warehouseId: projectAssignment.warehouseId,
      warehouseLocation: projectAssignment.warehouseLocation,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(inventoryItems.id, ids),
        sql`${inventoryItems.projectId} IS NULL`
      )
    )
    .returning({ id: inventoryItems.id });

  return {
    success: true,
    updatedCount: result.length,
  };
}

export async function bulkAssignInventoryProjectByFilters(
  filters: InventoryListFilters,
  projectId: number,
  warehouseId: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const ids = await getInventoryIdsByFilters({
    ...filters,
    unclassifiedOnly: true,
  });
  if (ids.length === 0) {
    return {
      success: true,
      updatedCount: 0,
    };
  }

  const projectAssignment = await resolveProjectAssignment(
    projectId,
    warehouseId
  );
  if (!projectAssignment) {
    throw new Error("Seleccione proyecto/bodega destino");
  }
  let updatedCount = 0;

  for (const idChunk of chunkItems(ids, DEMO_IMPORT_BATCH_SIZE)) {
    const result = await db
      .update(inventoryItems)
      .set({
        projectId: projectAssignment.projectId,
        warehouseId: projectAssignment.warehouseId,
        warehouseLocation: projectAssignment.warehouseLocation,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(inventoryItems.id, idChunk),
          sql`${inventoryItems.projectId} IS NULL`
        )
      )
      .returning({ id: inventoryItems.id });

    updatedCount += result.length;
  }

  return {
    success: true,
    updatedCount,
  };
}

export async function getInventoryItemBySapCode(sapItemCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.sapItemCode, sapItemCode))
    .limit(1);
  return result[0];
}

export async function lookupSapItemByCode(sapItemCode: string) {
  const db = await getDb();
  if (!db) return null;

  const normalizedSapItemCode = sapItemCode.trim();
  if (!normalizedSapItemCode) return null;

  const catalogTypeMatch = await db
    .select({
      tipoArticulo: sapCatalog.tipoArticulo,
      brand: sapCatalog.brand,
      partNumber: sapCatalog.partNumber,
    })
    .from(sapCatalog)
    .where(
      and(
        eq(sapCatalog.isActive, true),
        eq(sapCatalog.itemCode, normalizedSapItemCode)
      )
    )
    .limit(1);

  const inventoryMatch = await db
    .select({
      sapItemCode: inventoryItems.sapItemCode,
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
      brand: sapCatalog.brand,
      partNumber: sapCatalog.partNumber,
    })
    .from(inventoryItems)
    .leftJoin(sapCatalog, eq(inventoryItems.sapItemCode, sapCatalog.itemCode))
    .where(eq(inventoryItems.sapItemCode, normalizedSapItemCode))
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(1);

  if (inventoryMatch[0]) {
    return {
      sapItemCode: inventoryMatch[0].sapItemCode,
      itemName: inventoryMatch[0].itemName,
      unit: inventoryMatch[0].unit,
      tipoArticulo: catalogTypeMatch[0]?.tipoArticulo ?? 1,
      brand: inventoryMatch[0].brand ?? catalogTypeMatch[0]?.brand ?? null,
      partNumber:
        inventoryMatch[0].partNumber ?? catalogTypeMatch[0]?.partNumber ?? null,
      source: "inventory" as const,
    };
  }

  const catalogMatch = await db
    .select({
      itemCode: sapCatalog.itemCode,
      description: sapCatalog.description,
      tipoArticulo: sapCatalog.tipoArticulo,
      brand: sapCatalog.brand,
      partNumber: sapCatalog.partNumber,
    })
    .from(sapCatalog)
    .where(
      and(
        eq(sapCatalog.isActive, true),
        eq(sapCatalog.itemCode, normalizedSapItemCode)
      )
    )
    .limit(1);

  if (catalogMatch[0]) {
    return {
      sapItemCode: catalogMatch[0].itemCode,
      itemName: catalogMatch[0].description,
      unit: null,
      tipoArticulo: catalogMatch[0].tipoArticulo,
      brand: catalogMatch[0].brand,
      partNumber: catalogMatch[0].partNumber,
      source: "catalog" as const,
    };
  }

  const fuzzyMatches = await searchSapCatalog(normalizedSapItemCode);
  if (fuzzyMatches.length === 1) {
    return {
      sapItemCode: fuzzyMatches[0].itemCode,
      itemName: fuzzyMatches[0].description,
      unit: null,
      tipoArticulo: fuzzyMatches[0].tipoArticulo,
      brand: fuzzyMatches[0].brand,
      partNumber: fuzzyMatches[0].partNumber,
      source: "catalog" as const,
    };
  }

  return null;
}

// ============================================================
// SAP SYNC LOG
// ============================================================
export async function createSapSyncLog(data: InsertSapSyncLogEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [syncLog] = await db
    .insert(sapSyncLog)
    .values(data)
    .returning({ id: sapSyncLog.id });
  return { id: syncLog.id };
}

export async function getSapSyncLogByEntity(
  entityType: "supply_flow" | "reverse_logistic" | "inventory",
  entityId: number
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(sapSyncLog)
    .where(
      and(
        eq(sapSyncLog.entityType, entityType),
        eq(sapSyncLog.entityId, entityId)
      )
    )
    .orderBy(desc(sapSyncLog.createdAt));
}

// ============================================================
// DASHBOARD QUERIES
// ============================================================
export async function getDashboardStats(filters?: {
  requestedById?: number;
  projectId?: number;
  projectIds?: number[];
}) {
  const db = await getDb();
  if (!db) return null;

  const requestConditions = [];
  if (filters?.requestedById) {
    requestConditions.push(
      eq(materialRequests.requestedById, filters.requestedById)
    );
  }
  if (filters?.projectId) {
    requestConditions.push(eq(materialRequests.projectId, filters.projectId));
  }
  if (filters?.projectIds) {
    applyProjectScope(
      requestConditions,
      materialRequests.projectId,
      filters.projectIds
    );
  }
  const requestWhere =
    requestConditions.length > 0 ? and(...requestConditions) : undefined;

  const returnConditions = [];
  if (filters?.requestedById) {
    returnConditions.push(
      eq(reverseLogistics.createdById, filters.requestedById)
    );
  }
  if (filters?.projectId) {
    returnConditions.push(
      eq(reverseLogistics.sourceProjectId, filters.projectId)
    );
  }
  if (filters?.projectIds) {
    applyProjectScope(
      returnConditions,
      reverseLogistics.sourceProjectId,
      filters.projectIds
    );
  }
  const returnWhere =
    returnConditions.length > 0 ? and(...returnConditions) : undefined;
  const pendingReturnWhere =
    returnConditions.length > 0
      ? and(...returnConditions, eq(reverseLogistics.status, "pendiente"))
      : eq(reverseLogistics.status, "pendiente");

  const [requestsByStatus] = await Promise.all([
    db
      .select({
        status: materialRequests.status,
        count: count(),
      })
      .from(materialRequests)
      .where(requestWhere)
      .groupBy(materialRequests.status),
  ]);

  const [totalRequests] = await db
    .select({ count: count() })
    .from(materialRequests)
    .where(requestWhere);
  const [totalProjects] = filters?.projectIds
    ? filters.projectIds.length === 0
      ? [{ count: 0 }]
      : await db
          .select({ count: count() })
          .from(projects)
          .where(
            and(
              eq(projects.status, "activo"),
              inArray(projects.id, filters.projectIds)
            )
          )
    : filters?.projectId
      ? await db
          .select({ count: count() })
          .from(projects)
          .where(
            and(
              eq(projects.status, "activo"),
              eq(projects.id, filters.projectId)
            )
          )
      : filters?.requestedById
        ? await db
            .select({
              count: sql<number>`count(distinct ${materialRequests.projectId})`,
            })
            .from(materialRequests)
            .leftJoin(projects, eq(materialRequests.projectId, projects.id))
            .where(
              and(
                eq(projects.status, "activo"),
                eq(materialRequests.requestedById, filters.requestedById)
              )
            )
        : await db
            .select({ count: count() })
            .from(projects)
            .where(eq(projects.status, "activo"));
  const [totalReturns] = await db
    .select({ count: count() })
    .from(reverseLogistics)
    .where(returnWhere);
  const [pendingReturns] = await db
    .select({ count: count() })
    .from(reverseLogistics)
    .where(pendingReturnWhere);

  const requestsByProject = await db
    .select({
      projectId: materialRequests.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      count: count(),
    })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(requestWhere)
    .groupBy(materialRequests.projectId, projects.code, projects.name);

  const requestsByFlow = await db
    .select({
      flowType: supplyFlowRecords.flowType,
      count: count(),
    })
    .from(supplyFlowRecords)
    .leftJoin(
      materialRequests,
      eq(supplyFlowRecords.requestId, materialRequests.id)
    )
    .where(requestWhere)
    .groupBy(supplyFlowRecords.flowType);

  const recentRequests = await db
    .select({
      request: materialRequests,
      project: projects,
    })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(requestWhere)
    .orderBy(desc(materialRequests.createdAt))
    .limit(10);

  return {
    totalRequests: totalRequests?.count ?? 0,
    totalActiveProjects: totalProjects?.count ?? 0,
    totalReturns: totalReturns?.count ?? 0,
    pendingReturns: pendingReturns?.count ?? 0,
    requestsByStatus,
    requestsByProject,
    requestsByFlow,
    recentRequests,
  };
}

// Helper: notify users by role
export async function getUsersByBuildreqRole(role: BuildReqRole) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.buildreqRole, role));
}

export async function getUsersByBuildreqRoleAndProject(
  role: BuildReqRole,
  projectId: number
) {
  const db = await getDb();
  if (!db) return [];
  const roleUsers = await db
    .select()
    .from(users)
    .where(eq(users.buildreqRole, role));
  const hydratedUsers = await hydrateUsersWithAssignedProjects(roleUsers);
  return hydratedUsers.filter(user => {
    if (
      role === "administrador_proyecto" &&
      user.assignedProjectIds.length === 0
    ) {
      return true;
    }
    return user.assignedProjectIds.includes(projectId);
  });
}

// ============================================================
// INVITATIONS
// ============================================================
export async function createInvitation(
  data: InsertInvitation & { assignedProjectIds?: number[] | null }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { assignedProjectIds, ...invitationData } = data;
  const [invitation] = await db
    .insert(invitations)
    .values(invitationData)
    .returning({ id: invitations.id });
  if (assignedProjectIds !== undefined) {
    await replaceInvitationProjectAssignmentsForInvitation(
      invitation.id,
      assignedProjectIds
    );
  }
  return { id: invitation.id };
}

export async function getInvitationByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  if (!result[0]) return undefined;
  const [invitation] = await hydrateInvitationsWithAssignedProjects(result);
  return invitation;
}

export async function getInvitationByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(invitations)
    .where(
      and(eq(invitations.email, email), eq(invitations.status, "pendiente"))
    )
    .limit(1);
  if (!result[0]) return undefined;
  const [invitation] = await hydrateInvitationsWithAssignedProjects(result);
  return invitation;
}

export async function listInvitations() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(invitations)
    .orderBy(desc(invitations.createdAt));
  const hydrated = await hydrateInvitationsWithAssignedProjects(rows);
  return hydrated.map(invitation => ({
    invitation,
    project: invitation.assignedProjects[0] ?? null,
    assignedProjects: invitation.assignedProjects,
  }));
}

export async function acceptInvitation(invitationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(invitations)
    .set({
      status: "aceptada",
      acceptedAt: new Date(),
      acceptedUserId: userId,
    })
    .where(eq(invitations.id, invitationId));
  return { success: true };
}

export async function cancelInvitation(invitationId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(invitations)
    .set({ status: "cancelada" })
    .where(eq(invitations.id, invitationId));
  return { success: true };
}

/** Apply invitation role/project to user after OAuth login */
export async function applyInvitationToUser(
  userId: number,
  invitation: {
    buildreqRole: BuildReqRole;
    assignedProjectId: number | null;
    assignedProjectIds?: number[] | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const normalizedProjectIds =
    invitation.assignedProjectIds !== undefined
      ? normalizeProjectIds(invitation.assignedProjectIds)
      : invitation.assignedProjectId
        ? [invitation.assignedProjectId]
        : [];
  await db
    .update(users)
    .set({
      buildreqRole: invitation.buildreqRole,
      assignedProjectId: normalizedProjectIds[0] ?? null,
    })
    .where(eq(users.id, userId));
  await replaceUserProjectAssignmentsForUser(userId, normalizedProjectIds);
  return { success: true };
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return result[0];
}

// ============================================================
// SAP CATALOG
// ============================================================
export type ArticleType = 1 | 2 | 3;

export type ArticleListFilters = {
  search?: string;
  tipoArticulo?: ArticleType;
  isActive?: boolean;
  allowsTaxWithholding?: boolean;
  fixedAssetStatus?: "pendiente" | "resuelto";
  projectId?: number;
  temporaryOnly?: boolean;
  page?: number;
  pageSize?: number;
};

function buildArticleWhere(filters?: ArticleListFilters) {
  const conditions = [];

  if (filters?.search?.trim()) {
    const search = filters.search.trim();
    conditions.push(
      or(
        ilike(sapCatalog.itemCode, `%${search}%`),
        ilike(sapCatalog.temporaryItemCode, `%${search}%`),
        ilike(sapCatalog.description, `%${search}%`),
        ilike(sapCatalog.itemGroup, `%${search}%`),
        ilike(sapCatalog.brand, `%${search}%`),
        ilike(sapCatalog.partNumber, `%${search}%`),
        ilike(sapCatalog.fixedAssetSerialNumber, `%${search}%`)
      )!
    );
  }

  if (filters?.tipoArticulo) {
    conditions.push(eq(sapCatalog.tipoArticulo, filters.tipoArticulo));
  }

  if (filters?.isActive !== undefined) {
    conditions.push(eq(sapCatalog.isActive, filters.isActive));
  }

  if (filters?.allowsTaxWithholding !== undefined) {
    conditions.push(
      eq(sapCatalog.allowsTaxWithholding, filters.allowsTaxWithholding)
    );
  }

  if (filters?.fixedAssetStatus) {
    conditions.push(eq(sapCatalog.fixedAssetStatus, filters.fixedAssetStatus));
  }

  if (filters?.projectId) {
    conditions.push(eq(sapCatalog.projectId, filters.projectId));
  }

  if (filters?.temporaryOnly) {
    conditions.push(isNotNull(sapCatalog.temporaryItemCode));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listArticles(filters?: ArticleListFilters) {
  const db = await getDb();
  const requestedPage = Math.max(filters?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters?.pageSize ?? 25, 10), 200);

  if (!db) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }

  const where = buildArticleWhere(filters);
  const [totalResult] = await db
    .select({ count: count() })
    .from(sapCatalog)
    .where(where);

  const total = totalResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const items = await db
    .select()
    .from(sapCatalog)
    .where(where)
    .orderBy(asc(sapCatalog.itemCode))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function updateArticle(
  id: number,
  data: {
    itemCode?: string;
    description?: string;
    itemGroup?: string | null;
    brand?: string | null;
    partNumber?: string | null;
    tipoArticulo?: ArticleType;
    projectId?: number | null;
    isActive?: boolean;
    allowsTaxWithholding?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [article] = await db
    .update(sapCatalog)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(sapCatalog.id, id))
    .returning();

  if (!article) {
    throw new Error("Artículo no encontrado");
  }

  return article;
}

export async function createArticle(data: {
  itemCode: string;
  description: string;
  itemGroup?: string | null;
  brand?: string | null;
  partNumber?: string | null;
  tipoArticulo: ArticleType;
  projectId?: number | null;
  allowsTaxWithholding?: boolean;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const itemCode = data.itemCode.trim();
  const description = data.description.trim();
  if (!itemCode || !description) {
    throw new Error("Código y descripción son obligatorios");
  }

  const [existing] = await db
    .select({ id: sapCatalog.id })
    .from(sapCatalog)
    .where(eq(sapCatalog.itemCode, itemCode))
    .limit(1);

  if (existing) {
    throw new Error("Ya existe un artículo con ese código");
  }

  const [article] = await db
    .insert(sapCatalog)
    .values({
      itemCode,
      description,
      itemGroup: data.itemGroup?.trim() || null,
      brand: data.brand?.trim() || null,
      partNumber: data.partNumber?.trim() || null,
      tipoArticulo: data.tipoArticulo,
      projectId: data.tipoArticulo === 3 ? (data.projectId ?? null) : null,
      allowsTaxWithholding: data.allowsTaxWithholding ?? true,
      isActive: data.isActive ?? true,
    })
    .returning();

  return article;
}

function normalizeTemporaryProjectCode(projectCode: string) {
  const normalized = projectCode.trim().replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("El proyecto no tiene código para generar activo fijo");
  }
  return normalized;
}

export function buildTemporaryFixedAssetItemCode(params: {
  projectCode: string;
  existingCodes: Array<string | null | undefined>;
}) {
  const projectCode = normalizeTemporaryProjectCode(params.projectCode);
  const prefix = `OC-${projectCode}-`;
  const sequencePattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{4})$`, "i");
  const maxSequence = params.existingCodes.reduce((max, value) => {
    const match = String(value ?? "").match(sequencePattern);
    if (!match) return max;

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);

  return `${prefix}${String(maxSequence + 1).padStart(4, "0")}`;
}

async function generateTemporaryFixedAssetCodes(params: {
  projectId: number;
  count: number;
  tx?: Awaited<ReturnType<typeof getDb>>;
}) {
  const database = params.tx ?? (await getDb());
  if (!database) throw new Error("DB not available");
  const countToGenerate = Math.max(Math.trunc(params.count), 0);
  if (countToGenerate === 0) return [];

  const project = await getProjectById(params.projectId);
  if (!project) {
    throw new Error("Proyecto no encontrado");
  }

  const projectCode = normalizeTemporaryProjectCode(project.code);
  const prefix = `OC-${projectCode}-`;
  const rows = await database
    .select({
      itemCode: sapCatalog.itemCode,
      temporaryItemCode: sapCatalog.temporaryItemCode,
    })
    .from(sapCatalog)
    .where(
      or(
        ilike(sapCatalog.itemCode, `${prefix}%`),
        ilike(sapCatalog.temporaryItemCode, `${prefix}%`)
      )
    );
  const existingNumbers = rows.flatMap(row => [
    row.itemCode,
    row.temporaryItemCode,
  ]);

  const nextCodes: string[] = [];
  for (let index = 0; index < countToGenerate; index += 1) {
    const nextCode = buildTemporaryFixedAssetItemCode({
      projectCode,
      existingCodes: [...existingNumbers, ...nextCodes],
    });
    nextCodes.push(nextCode);
  }

  return nextCodes;
}

function getFixedAssetDetailFromArticle(article: {
  fixedAssetSerialNumber: string | null;
  fixedAssetCondition: FixedAssetDetail["condition"] | null;
  fixedAssetColor: string | null;
  fixedAssetModel: string | null;
  fixedAssetBrand: string | null;
  fixedAssetChassisSeries: string | null;
  fixedAssetMotorSeries: string | null;
  fixedAssetPlateOrCode: string | null;
}): FixedAssetDetail {
  return {
    serialNumber: article.fixedAssetSerialNumber ?? "",
    condition: article.fixedAssetCondition ?? "nuevo",
    color: article.fixedAssetColor ?? "",
    model: article.fixedAssetModel ?? "",
    brand: article.fixedAssetBrand ?? "",
    chassisSeries: article.fixedAssetChassisSeries ?? "",
    motorSeries: article.fixedAssetMotorSeries ?? "",
    plateOrCode: article.fixedAssetPlateOrCode ?? "",
  };
}

export async function savePurchaseOrderFixedAssetDraftLine(params: {
  purchaseOrderItemId: number;
  isLeasing?: boolean;
  lineObservation?: string | null;
  assetDetails: FixedAssetDetail[];
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return db.transaction(async tx => {
    const [itemDetail] = await tx
      .select({
        item: purchaseOrderItems,
        purchaseOrder: purchaseOrders,
        project: projects,
      })
      .from(purchaseOrderItems)
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)
      )
      .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
      .where(eq(purchaseOrderItems.id, params.purchaseOrderItemId))
      .limit(1);

    if (!itemDetail) {
      throw new Error("Línea de OC no encontrada");
    }

    const normalizedDetails = normalizeFixedAssetDetails(
      params.assetDetails,
      params.assetDetails.length
    );
    if (normalizedDetails.length === 0) {
      throw new Error("Registre al menos una unidad del activo fijo");
    }
    const missingIndex = normalizedDetails.findIndex(
      detail => !detail.serialNumber.trim() || !detail.condition
    );
    if (missingIndex >= 0) {
      throw new Error(
        `Complete serie y condición de la unidad ${missingIndex + 1}`
      );
    }

    const sourceArticles = await tx
      .select()
      .from(sapCatalog)
      .where(
        eq(sapCatalog.fixedAssetSourcePurchaseOrderItemId, itemDetail.item.id)
      )
      .orderBy(asc(sapCatalog.itemCode));
    const existingArticles = [...sourceArticles];
    if (
      itemDetail.item.fixedAssetArticleId &&
      !existingArticles.some(
        article => article.id === itemDetail.item.fixedAssetArticleId
      )
    ) {
      const [legacyArticle] = await tx
        .select()
        .from(sapCatalog)
        .where(eq(sapCatalog.id, itemDetail.item.fixedAssetArticleId))
        .limit(1);
      if (legacyArticle) {
        existingArticles.unshift(legacyArticle);
      }
    }

    if (
      existingArticles.some(
        article => article.fixedAssetStatus === "resuelto"
      ) ||
      (existingArticles.length === 0 &&
        itemDetail.item.fixedAssetStatus === "resuelto")
    ) {
      throw new Error("El activo fijo ya fue resuelto por Contabilidad");
    }

    const newTemporaryCodes = await generateTemporaryFixedAssetCodes({
      projectId: itemDetail.purchaseOrder.projectId,
      count: Math.max(normalizedDetails.length - existingArticles.length, 0),
      tx: tx as any,
    });
    let newTemporaryCodeIndex = 0;
    const articles = [];
    const now = new Date();

    for (let index = 0; index < normalizedDetails.length; index += 1) {
      const detail = normalizedDetails[index];
      const existingArticle = existingArticles[index];
      const temporaryCode =
        existingArticle?.temporaryItemCode ??
        existingArticle?.itemCode ??
        newTemporaryCodes[newTemporaryCodeIndex++];
      if (!temporaryCode) {
        throw new Error("No se pudo generar el código temporal del activo");
      }

      const articleValues = {
        itemCode: temporaryCode,
        temporaryItemCode: temporaryCode,
        description: itemDetail.item.itemName,
        itemGroup: "Activo fijo temporal",
        tipoArticulo: 3 as const,
        projectId: itemDetail.purchaseOrder.projectId,
        fixedAssetStatus: "pendiente",
        fixedAssetSourcePurchaseOrderId: itemDetail.purchaseOrder.id,
        fixedAssetSourcePurchaseOrderItemId: itemDetail.item.id,
        fixedAssetSerialNumber: detail.serialNumber,
        fixedAssetCondition: detail.condition,
        fixedAssetColor: detail.color || null,
        fixedAssetModel: detail.model || null,
        fixedAssetBrand: detail.brand || null,
        fixedAssetChassisSeries: detail.chassisSeries || null,
        fixedAssetMotorSeries: detail.motorSeries || null,
        fixedAssetPlateOrCode: detail.plateOrCode || null,
        fixedAssetIsLeasing: params.isLeasing === true,
        fixedAssetObservation: params.lineObservation?.trim() || null,
        allowsTaxWithholding: true,
        isActive: true,
        updatedAt: now,
      };

      const [article] = existingArticle
        ? await tx
            .update(sapCatalog)
            .set(articleValues)
            .where(eq(sapCatalog.id, existingArticle.id))
            .returning()
        : await tx.insert(sapCatalog).values(articleValues).returning();
      if (!article) {
        throw new Error("No se pudo crear el artículo temporal");
      }
      articles.push(article);
    }

    const extraArticleIds = existingArticles
      .slice(normalizedDetails.length)
      .filter(article => article.fixedAssetStatus !== "resuelto")
      .map(article => article.id);
    if (extraArticleIds.length > 0) {
      await tx
        .update(sapCatalog)
        .set({ isActive: false, updatedAt: now })
        .where(inArray(sapCatalog.id, extraArticleIds));
    }

    const primaryArticle = articles[0];
    if (!primaryArticle) {
      throw new Error("No se pudo crear el artículo temporal");
    }

    const [updatedItem] = await tx
      .update(purchaseOrderItems)
      .set({
        isFixedAsset: true,
        isLeasing: params.isLeasing === true,
        assetDetails: normalizedDetails,
        lineObservation: params.lineObservation?.trim() || null,
        fixedAssetArticleId: primaryArticle.id,
        fixedAssetStatus: "pendiente",
        currentSapItemCode: primaryArticle.itemCode,
        updatedAt: now,
      })
      .where(eq(purchaseOrderItems.id, itemDetail.item.id))
      .returning();

    return { article: primaryArticle, articles, item: updatedItem };
  });
}

export async function resolveFixedAssetArticleCode(params: {
  id: number;
  itemCode: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const nextItemCode = params.itemCode.trim();
  if (!nextItemCode) {
    throw new Error("Ingrese el código real del activo fijo");
  }

  return db.transaction(async tx => {
    const [article] = await tx
      .select()
      .from(sapCatalog)
      .where(eq(sapCatalog.id, params.id))
      .limit(1);
    if (!article) {
      throw new Error("Artículo no encontrado");
    }
    if (article.tipoArticulo !== 3 || !article.temporaryItemCode) {
      throw new Error("El artículo no es un activo fijo temporal");
    }
    if (article.fixedAssetStatus !== "pendiente") {
      throw new Error("Este activo fijo ya fue resuelto");
    }

    const [duplicate] = await tx
      .select({ id: sapCatalog.id })
      .from(sapCatalog)
      .where(
        and(
          eq(sapCatalog.itemCode, nextItemCode),
          sql`${sapCatalog.id} <> ${article.id}`
        )
      )
      .limit(1);
    if (duplicate) {
      throw new Error("Ya existe un artículo con ese código");
    }

    const [updatedArticle] = await tx
      .update(sapCatalog)
      .set({
        itemCode: nextItemCode,
        fixedAssetStatus: "resuelto",
        updatedAt: new Date(),
      })
      .where(eq(sapCatalog.id, article.id))
      .returning();

    if (article.fixedAssetSourcePurchaseOrderItemId) {
      const [sourceItem] = await tx
        .select({
          fixedAssetArticleId: purchaseOrderItems.fixedAssetArticleId,
        })
        .from(purchaseOrderItems)
        .where(
          eq(purchaseOrderItems.id, article.fixedAssetSourcePurchaseOrderItemId)
        )
        .limit(1);
      const [pendingSibling] = await tx
        .select({ id: sapCatalog.id })
        .from(sapCatalog)
        .where(
          and(
            eq(
              sapCatalog.fixedAssetSourcePurchaseOrderItemId,
              article.fixedAssetSourcePurchaseOrderItemId
            ),
            eq(sapCatalog.fixedAssetStatus, "pendiente"),
            eq(sapCatalog.isActive, true)
          )
        )
        .limit(1);
      await tx
        .update(purchaseOrderItems)
        .set({
          ...(sourceItem?.fixedAssetArticleId === article.id
            ? { currentSapItemCode: nextItemCode }
            : {}),
          fixedAssetStatus: pendingSibling ? "pendiente" : "resuelto",
          updatedAt: new Date(),
        })
        .where(
          eq(purchaseOrderItems.id, article.fixedAssetSourcePurchaseOrderItemId)
        );
    } else {
      await tx
        .update(purchaseOrderItems)
        .set({
          currentSapItemCode: nextItemCode,
          fixedAssetStatus: "resuelto",
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderItems.fixedAssetArticleId, article.id));
    }

    return updatedArticle;
  });
}

export async function updateFixedAssetArticleDetails(params: {
  id: number;
  isLeasing?: boolean;
  observation?: string | null;
  assetDetail: FixedAssetDetail;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  if (!params.assetDetail.serialNumber.trim()) {
    throw new Error("Ingrese el número de serie del activo");
  }
  if (!params.assetDetail.condition) {
    throw new Error("Seleccione la condición del activo");
  }

  const normalizedDetail: FixedAssetDetail = {
    serialNumber: params.assetDetail.serialNumber.trim(),
    condition: params.assetDetail.condition,
    color: params.assetDetail.color?.trim() || "",
    model: params.assetDetail.model?.trim() || "",
    brand: params.assetDetail.brand?.trim() || "",
    chassisSeries: params.assetDetail.chassisSeries?.trim() || "",
    motorSeries: params.assetDetail.motorSeries?.trim() || "",
    plateOrCode: params.assetDetail.plateOrCode?.trim() || "",
  };
  const observation = params.observation?.trim() || null;
  const isLeasing = params.isLeasing === true;

  return db.transaction(async tx => {
    const [article] = await tx
      .select()
      .from(sapCatalog)
      .where(eq(sapCatalog.id, params.id))
      .limit(1);
    if (!article) {
      throw new Error("Artículo no encontrado");
    }
    if (article.tipoArticulo !== 3) {
      throw new Error("El artículo no es un activo fijo");
    }

    const [updatedArticle] = await tx
      .update(sapCatalog)
      .set({
        fixedAssetSerialNumber: normalizedDetail.serialNumber,
        fixedAssetCondition: normalizedDetail.condition,
        fixedAssetColor: normalizedDetail.color || null,
        fixedAssetModel: normalizedDetail.model || null,
        fixedAssetBrand: normalizedDetail.brand || null,
        fixedAssetChassisSeries: normalizedDetail.chassisSeries || null,
        fixedAssetMotorSeries: normalizedDetail.motorSeries || null,
        fixedAssetPlateOrCode: normalizedDetail.plateOrCode || null,
        fixedAssetIsLeasing: isLeasing,
        fixedAssetObservation: observation,
        updatedAt: new Date(),
      })
      .where(eq(sapCatalog.id, article.id))
      .returning();

    if (article.fixedAssetSourcePurchaseOrderItemId) {
      const siblingArticles = await tx
        .select()
        .from(sapCatalog)
        .where(
          and(
            eq(
              sapCatalog.fixedAssetSourcePurchaseOrderItemId,
              article.fixedAssetSourcePurchaseOrderItemId
            ),
            eq(sapCatalog.isActive, true)
          )
        )
        .orderBy(asc(sapCatalog.itemCode));
      await tx
        .update(purchaseOrderItems)
        .set({
          isFixedAsset: true,
          isLeasing,
          assetDetails: siblingArticles.map(getFixedAssetDetailFromArticle),
          lineObservation: observation,
          updatedAt: new Date(),
        })
        .where(
          eq(purchaseOrderItems.id, article.fixedAssetSourcePurchaseOrderItemId)
        );
    } else {
      await tx
        .update(purchaseOrderItems)
        .set({
          isFixedAsset: true,
          isLeasing,
          assetDetails: [normalizedDetail],
          lineObservation: observation,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderItems.fixedAssetArticleId, article.id));
    }

    return updatedArticle;
  });
}

const SEARCH_ACCENTED_CHARACTERS = "áàâäãåéèêëíìîïóòôöõúùûüñç";
const SEARCH_UNACCENTED_CHARACTERS = "aaaaaaeeeeiiiiooooouuuunc";

function normalizeSearchInput(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getSearchTokens(value: string) {
  return normalizeSearchInput(value).split(" ").filter(Boolean).slice(0, 8);
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function containsSearchPattern(value: string) {
  return `%${escapeLikePattern(value)}%`;
}

function prefixSearchPattern(value: string) {
  return `${escapeLikePattern(value)}%`;
}

function normalizedSearchSql(column: any) {
  return sql`translate(lower(coalesce(${column}, '')), ${SEARCH_ACCENTED_CHARACTERS}, ${SEARCH_UNACCENTED_CHARACTERS})`;
}

function normalizedLike(column: any, pattern: string) {
  return sql`${normalizedSearchSql(column)} like ${pattern} escape ${"\\"}`;
}

function buildSearchTokenConditions(search: string, columns: any[]) {
  const tokens = getSearchTokens(search);
  return tokens.map(
    token =>
      or(
        ...columns.map(column =>
          normalizedLike(column, containsSearchPattern(token))
        )
      )!
  );
}

export async function searchSapCatalog(search: string) {
  const db = await getDb();
  if (!db) return [];
  const normalizedSearch = normalizeSearchInput(search);
  if (!normalizedSearch) return [];

  const codeSearch = normalizedSearchSql(sapCatalog.itemCode);
  const descriptionSearch = normalizedSearchSql(sapCatalog.description);
  const partNumberSearch = normalizedSearchSql(sapCatalog.partNumber);

  return db
    .select()
    .from(sapCatalog)
    .where(
      and(
        eq(sapCatalog.isActive, true),
        ...buildSearchTokenConditions(search, [
          sapCatalog.itemCode,
          sapCatalog.description,
          sapCatalog.brand,
          sapCatalog.partNumber,
        ])
      )
    )
    .orderBy(
      sql`case
        when ${codeSearch} = ${normalizedSearch} then 0
        when ${codeSearch} like ${prefixSearchPattern(normalizedSearch)} escape ${"\\"} then 1
        when ${descriptionSearch} = ${normalizedSearch} then 2
        when ${descriptionSearch} like ${prefixSearchPattern(normalizedSearch)} escape ${"\\"} then 3
        when ${partNumberSearch} = ${normalizedSearch} then 4
        when ${partNumberSearch} like ${prefixSearchPattern(normalizedSearch)} escape ${"\\"} then 5
        when ${descriptionSearch} like ${containsSearchPattern(normalizedSearch)} escape ${"\\"} then 6
        else 7
      end`,
      asc(sapCatalog.itemCode)
    )
    .limit(20);
}

export async function listSapCatalog() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(sapCatalog)
    .where(eq(sapCatalog.isActive, true))
    .orderBy(sapCatalog.itemCode);
}

// ============================================================
// SUPPLIERS
// ============================================================
export async function getSupplierById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  return result[0];
}

export async function listSuppliers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(suppliers.name);
}

export async function searchSuppliers(search: string) {
  const db = await getDb();
  if (!db) return [];
  const normalizedSearch = normalizeSearchInput(search);
  if (!normalizedSearch) return [];

  const supplierCodeSearch = normalizedSearchSql(suppliers.supplierCode);
  const supplierNameSearch = normalizedSearchSql(suppliers.name);

  return db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.isActive, true),
        ...buildSearchTokenConditions(search, [
          suppliers.supplierCode,
          suppliers.name,
          suppliers.rtn,
          suppliers.address,
        ])
      )
    )
    .orderBy(
      sql`case
        when ${supplierCodeSearch} = ${normalizedSearch} then 0
        when ${supplierCodeSearch} like ${prefixSearchPattern(normalizedSearch)} escape ${"\\"} then 1
        when ${supplierNameSearch} like ${prefixSearchPattern(normalizedSearch)} escape ${"\\"} then 2
        when ${supplierNameSearch} like ${containsSearchPattern(normalizedSearch)} escape ${"\\"} then 3
        else 4
      end`,
      asc(suppliers.name)
    )
    .limit(20);
}

export type SupplierListFilters = {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
};

function buildSupplierWhere(filters?: SupplierListFilters) {
  const conditions = [];

  if (filters?.search?.trim()) {
    const search = filters.search.trim();
    conditions.push(
      or(
        ilike(suppliers.supplierCode, `%${search}%`),
        ilike(suppliers.name, `%${search}%`),
        ilike(suppliers.email, `%${search}%`),
        ilike(suppliers.rtn, `%${search}%`),
        ilike(suppliers.address, `%${search}%`)
      )!
    );
  }

  if (filters?.isActive !== undefined) {
    conditions.push(eq(suppliers.isActive, filters.isActive));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listSupplierCatalog(filters?: SupplierListFilters) {
  const db = await getDb();
  const requestedPage = Math.max(filters?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters?.pageSize ?? 25, 10), 200);

  if (!db) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize,
      totalPages: 1,
    };
  }

  const where = buildSupplierWhere(filters);
  const [totalResult] = await db
    .select({ count: count() })
    .from(suppliers)
    .where(where);

  const total = totalResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const items = await db
    .select()
    .from(suppliers)
    .where(where)
    .orderBy(asc(suppliers.name))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function updateSupplier(
  id: number,
  data: {
    rtn?: string | null;
    address?: string | null;
    allowsTaxWithholding?: boolean;
    subjectToAccountPayments?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [supplier] = await db
    .update(suppliers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(suppliers.id, id))
    .returning();

  if (!supplier) {
    throw new Error("Proveedor no encontrado");
  }

  return supplier;
}

async function buildSupplierExcelImportAnalysisFromDb(
  input: SupplierExcelFileInput
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const parsed = parseSupplierExcelWorkbook(input);
  const existingSuppliers = await db
    .select({
      id: suppliers.id,
      supplierCode: suppliers.supplierCode,
      rtn: suppliers.rtn,
      allowsTaxWithholding: suppliers.allowsTaxWithholding,
      subjectToAccountPayments: suppliers.subjectToAccountPayments,
    })
    .from(suppliers);

  return {
    db,
    analysis: buildSupplierExcelImportAnalysis(parsed, existingSuppliers),
  };
}

export async function analyzeSupplierExcelImport(
  input: SupplierExcelFileInput
) {
  const { analysis } = await buildSupplierExcelImportAnalysisFromDb(input);
  return summarizeSupplierExcelImportAnalysis(analysis);
}

export async function importSupplierExcel(input: SupplierExcelFileInput) {
  const { db, analysis } = await buildSupplierExcelImportAnalysisFromDb(input);

  if (analysis.errors.length > 0) {
    throw new Error(
      analysis.errors[0]?.message ?? "El archivo contiene errores"
    );
  }

  const now = new Date();

  for (const supplierChunk of chunkItems(
    analysis.rows,
    DEMO_IMPORT_BATCH_SIZE
  )) {
    if (supplierChunk.length === 0) continue;

    await db
      .insert(suppliers)
      .values(
        supplierChunk.map(row => ({
          supplierCode: row.supplierCode,
          name: row.name,
          email: row.email,
          rtn: row.rtn,
          address: row.address,
          allowsTaxWithholding: row.allowsTaxWithholding,
          subjectToAccountPayments: row.subjectToAccountPayments,
          isActive: true,
          demoBatchKey: null,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: suppliers.supplierCode,
        set: {
          name: sql`excluded."name"`,
          email: sql`excluded."email"`,
          rtn: sql`excluded."rtn"`,
          address: sql`excluded."address"`,
          allowsTaxWithholding: sql`excluded."allowsTaxWithholding"`,
          subjectToAccountPayments: sql`excluded."subjectToAccountPayments"`,
          isActive: sql`excluded."isActive"`,
          demoBatchKey: sql`excluded."demoBatchKey"`,
          updatedAt: sql`excluded."updatedAt"`,
        },
      });
  }

  return {
    ...summarizeSupplierExcelImportAnalysis(analysis),
    inserted: analysis.insertCount,
    updated: analysis.updateCount,
  };
}

export async function listSupplierContacts(params: {
  supplierId: number;
  projectId?: number;
  projectIds?: number[];
  includeInactive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(supplierContacts.supplierId, params.supplierId)];
  if (params.projectId) {
    conditions.push(eq(supplierContacts.projectId, params.projectId));
  }
  if (params.projectIds) {
    applyProjectScope(
      conditions,
      supplierContacts.projectId,
      params.projectIds
    );
  }
  if (!params.includeInactive) {
    conditions.push(eq(supplierContacts.isActive, true));
  }

  return db
    .select({
      contact: supplierContacts,
      project: projects,
    })
    .from(supplierContacts)
    .leftJoin(projects, eq(supplierContacts.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(
      asc(projects.code),
      desc(supplierContacts.isActive),
      asc(supplierContacts.name)
    );
}

export async function getSupplierContactById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const [contact] = await db
    .select()
    .from(supplierContacts)
    .where(eq(supplierContacts.id, id))
    .limit(1);

  return contact;
}

export async function createSupplierContact(data: InsertSupplierContact) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [contact] = await db.insert(supplierContacts).values(data).returning();

  return contact;
}

export async function updateSupplierContact(
  id: number,
  data: Partial<
    Pick<
      InsertSupplierContact,
      | "projectId"
      | "contactType"
      | "branchName"
      | "name"
      | "phone"
      | "email"
      | "address"
      | "isActive"
    >
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [contact] = await db
    .update(supplierContacts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(supplierContacts.id, id))
    .returning();

  if (!contact) {
    throw new Error("Contacto no encontrado");
  }

  return contact;
}

export type SupplierDocumentListRow = {
  document: SupplierDocument;
  documentType: SupplierDocumentType;
  attachment: Attachment;
  createdBy: Pick<User, "id" | "name" | "email"> | null;
};

export async function listSupplierDocumentTypes(params?: {
  includeInactive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (!params?.includeInactive) {
    conditions.push(eq(supplierDocumentTypes.isActive, true));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(supplierDocumentTypes)
    .where(where)
    .orderBy(
      desc(supplierDocumentTypes.isActive),
      asc(supplierDocumentTypes.name)
    );
}

export async function getSupplierDocumentTypeById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const [documentType] = await db
    .select()
    .from(supplierDocumentTypes)
    .where(eq(supplierDocumentTypes.id, id))
    .limit(1);

  return documentType;
}

export async function createSupplierDocumentType(
  data: InsertSupplierDocumentType
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [documentType] = await db
    .insert(supplierDocumentTypes)
    .values(data)
    .returning();

  return documentType;
}

export async function updateSupplierDocumentType(
  id: number,
  data: Partial<
    Pick<
      InsertSupplierDocumentType,
      "code" | "name" | "description" | "expirationMode" | "isActive"
    >
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [documentType] = await db
    .update(supplierDocumentTypes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(supplierDocumentTypes.id, id))
    .returning();

  if (!documentType) {
    throw new Error("Tipo de documento no encontrado");
  }

  return documentType;
}

export async function listSupplierDocuments(supplierId: number) {
  const db = await getDb();
  if (!db) return [] as SupplierDocumentListRow[];

  return db
    .select({
      document: supplierDocuments,
      documentType: supplierDocumentTypes,
      attachment: attachments,
      createdBy: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(supplierDocuments)
    .innerJoin(
      supplierDocumentTypes,
      eq(supplierDocuments.documentTypeId, supplierDocumentTypes.id)
    )
    .innerJoin(attachments, eq(supplierDocuments.attachmentId, attachments.id))
    .leftJoin(users, eq(supplierDocuments.createdById, users.id))
    .where(eq(supplierDocuments.supplierId, supplierId))
    .orderBy(
      desc(supplierDocuments.documentDate),
      desc(supplierDocuments.createdAt)
    );
}

export async function getSupplierDocumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const [document] = await db
    .select({
      document: supplierDocuments,
      documentType: supplierDocumentTypes,
      attachment: attachments,
      createdBy: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(supplierDocuments)
    .innerJoin(
      supplierDocumentTypes,
      eq(supplierDocuments.documentTypeId, supplierDocumentTypes.id)
    )
    .innerJoin(attachments, eq(supplierDocuments.attachmentId, attachments.id))
    .leftJoin(users, eq(supplierDocuments.createdById, users.id))
    .where(eq(supplierDocuments.id, id))
    .limit(1);

  return document;
}

export async function createSupplierDocument(data: InsertSupplierDocument) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [document] = await db
    .insert(supplierDocuments)
    .values(data)
    .returning();

  return document;
}

export async function updateSupplierDocument(
  id: number,
  data: Partial<
    Pick<
      InsertSupplierDocument,
      "documentTypeId" | "documentDate" | "expirationDate" | "description"
    >
  >
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [document] = await db
    .update(supplierDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(supplierDocuments.id, id))
    .returning();

  if (!document) {
    throw new Error("Documento del proveedor no encontrado");
  }

  return document;
}

export type DemoImportCounters = {
  totalInput: number;
  inserted: number;
  updated: number;
  skipped: number;
};

export type DemoImportResult = {
  batchKey: string;
  projects: DemoImportCounters;
  articles: DemoImportCounters;
  inventoryRows: DemoImportCounters;
  suppliers: DemoImportCounters;
};

export type DemoImportProgressSnapshot = {
  stage: "projects" | "articles" | "inventory" | "suppliers";
  stageLabel: string;
  totalRows: number;
  processedRows: number;
  currentStageTotal: number;
  currentStageProcessed: number;
  percent: number;
};

type DemoImportOptions = {
  onProgress?: (snapshot: DemoImportProgressSnapshot) => void | Promise<void>;
};

const DEMO_IMPORT_BATCH_SIZE = 300;

function createDemoImportCounters(totalInput = 0): DemoImportCounters {
  return {
    totalInput,
    inserted: 0,
    updated: 0,
    skipped: 0,
  };
}

function chunkItems<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function createProgressReporter(
  totalRows: number,
  onProgress?: DemoImportOptions["onProgress"]
) {
  let processedRows = 0;

  return async ({
    stage,
    stageLabel,
    currentStageProcessed,
    currentStageTotal,
    increment = 0,
  }: {
    stage: DemoImportProgressSnapshot["stage"];
    stageLabel: string;
    currentStageProcessed: number;
    currentStageTotal: number;
    increment?: number;
  }) => {
    processedRows += increment;

    if (!onProgress) return;

    const boundedProcessed = Math.min(processedRows, totalRows);
    const percent =
      totalRows <= 0
        ? 100
        : Math.min(100, Math.round((boundedProcessed / totalRows) * 100));

    await onProgress({
      stage,
      stageLabel,
      totalRows,
      processedRows: boundedProcessed,
      currentStageProcessed,
      currentStageTotal,
      percent,
    });
  };
}

export async function getDemoDataSummary() {
  const db = await getDb();
  if (!db) {
    return {
      projects: 0,
      articles: 0,
      inventoryRows: 0,
      suppliers: 0,
      hasDemoData: false,
    };
  }

  const [projectCount, articleCount, inventoryCount, supplierCount] =
    await Promise.all([
      db
        .select({ count: count() })
        .from(projects)
        .where(isNotNull(projects.demoBatchKey)),
      db
        .select({ count: count() })
        .from(sapCatalog)
        .where(isNotNull(sapCatalog.demoBatchKey)),
      db
        .select({ count: count() })
        .from(inventoryItems)
        .where(isNotNull(inventoryItems.demoBatchKey)),
      db
        .select({ count: count() })
        .from(suppliers)
        .where(isNotNull(suppliers.demoBatchKey)),
    ]);

  const projectsTotal = projectCount[0]?.count ?? 0;
  const articlesTotal = articleCount[0]?.count ?? 0;
  const inventoryTotal = inventoryCount[0]?.count ?? 0;
  const suppliersTotal = supplierCount[0]?.count ?? 0;

  return {
    projects: projectsTotal,
    articles: articlesTotal,
    inventoryRows: inventoryTotal,
    suppliers: suppliersTotal,
    hasDemoData:
      projectsTotal + articlesTotal + inventoryTotal + suppliersTotal > 0,
  };
}

export async function importDemoData(
  payload: ParsedDemoImportPayload,
  importedById: number,
  options?: DemoImportOptions
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const batchKey = `demo-${importedById}-${Date.now()}`;
  const projectSummary = createDemoImportCounters(payload.projects.length);
  const inventorySummary = createDemoImportCounters(payload.articles.length);
  const supplierSummary = createDemoImportCounters(payload.suppliers.length);
  const catalogArticles = Array.from(
    new Map(
      payload.articles.map(article => [article.itemCode, article])
    ).values()
  );
  const articleSummary = createDemoImportCounters(catalogArticles.length);
  const importedWarehouses = await ensureWarehouses(
    payload.articles
      .map(article => {
        const code = article.warehouseCode?.trim();
        const name = article.warehouseName?.trim();
        if (code && name) {
          return { code, name } satisfies WarehouseSeedInput;
        }

        const parsedLocation = parseWarehouseLocation(
          article.warehouseLocation
        );
        if (!parsedLocation) return null;

        return {
          code: parsedLocation.code,
          name: parsedLocation.name,
        } satisfies WarehouseSeedInput;
      })
      .filter((warehouse): warehouse is WarehouseSeedInput =>
        Boolean(warehouse)
      )
  );
  const importedWarehouseMap = new Map(
    importedWarehouses.map(warehouse => [
      normalizeWarehouseLocationKey(warehouse.displayName),
      warehouse,
    ])
  );
  const workload = getDemoImportWorkload(payload);
  const reportProgress = createProgressReporter(
    workload.totalRows,
    options?.onProgress
  );

  let projectStageProcessed = 0;
  await reportProgress({
    stage: "projects",
    stageLabel: "Procesando proyectos",
    currentStageProcessed: 0,
    currentStageTotal: payload.projects.length,
  });

  for (const projectChunk of chunkItems(
    payload.projects,
    DEMO_IMPORT_BATCH_SIZE
  )) {
    if (projectChunk.length === 0) continue;

    const projectCodes = projectChunk.map(project => project.code);
    const existingProjects = await db
      .select()
      .from(projects)
      .where(inArray(projects.code, projectCodes));

    const existingProjectMap = new Map(
      existingProjects.map(project => [project.code, project])
    );

    const projectsToPersist: InsertProject[] = [];

    for (const project of projectChunk) {
      const existingProject = existingProjectMap.get(project.code);
      const insertPayload: InsertProject = {
        code: project.code,
        name: project.name,
        description: project.description,
        location: project.location,
        sapProjectCode: project.sapProjectCode,
        status: "activo",
        demoBatchKey: batchKey,
        updatedAt: new Date(),
      };

      if (existingProject && !existingProject.demoBatchKey) {
        projectSummary.skipped += 1;
        continue;
      }

      if (existingProject) {
        projectSummary.updated += 1;
      } else {
        projectSummary.inserted += 1;
      }

      projectsToPersist.push(insertPayload);
    }

    if (projectsToPersist.length > 0) {
      await db
        .insert(projects)
        .values(projectsToPersist)
        .onConflictDoUpdate({
          target: projects.code,
          set: {
            name: sql`excluded."name"`,
            description: sql`excluded."description"`,
            location: sql`excluded."location"`,
            sapProjectCode: sql`excluded."sapProjectCode"`,
            status: sql`excluded."status"`,
            demoBatchKey: sql`excluded."demoBatchKey"`,
            updatedAt: sql`excluded."updatedAt"`,
          },
          where: isNotNull(projects.demoBatchKey),
        });
    }

    projectStageProcessed += projectChunk.length;
    await reportProgress({
      stage: "projects",
      stageLabel: "Procesando proyectos",
      currentStageProcessed: projectStageProcessed,
      currentStageTotal: payload.projects.length,
      increment: projectChunk.length,
    });
  }

  let articleStageProcessed = 0;
  await reportProgress({
    stage: "articles",
    stageLabel: "Actualizando catalogo SAP",
    currentStageProcessed: 0,
    currentStageTotal: catalogArticles.length,
  });

  for (const articleChunk of chunkItems(
    catalogArticles,
    DEMO_IMPORT_BATCH_SIZE
  )) {
    if (articleChunk.length === 0) continue;

    const articleCodes = articleChunk.map(article => article.itemCode);
    const existingCatalog = await db
      .select()
      .from(sapCatalog)
      .where(inArray(sapCatalog.itemCode, articleCodes));

    const existingCatalogMap = new Map(
      existingCatalog.map(article => [article.itemCode, article])
    );

    const articlesToPersist: InsertSapCatalogItem[] = [];

    for (const article of articleChunk) {
      const existingArticle = existingCatalogMap.get(article.itemCode);
      const insertPayload: InsertSapCatalogItem = {
        itemCode: article.itemCode,
        description: article.fullDescription ?? article.description,
        isActive: true,
        demoBatchKey: batchKey,
        updatedAt: new Date(),
      };

      if (existingArticle && !existingArticle.demoBatchKey) {
        articleSummary.skipped += 1;
        continue;
      }

      if (existingArticle) {
        articleSummary.updated += 1;
      } else {
        articleSummary.inserted += 1;
      }

      articlesToPersist.push(insertPayload);
    }

    if (articlesToPersist.length > 0) {
      await db
        .insert(sapCatalog)
        .values(articlesToPersist)
        .onConflictDoUpdate({
          target: sapCatalog.itemCode,
          set: {
            description: sql`excluded."description"`,
            isActive: sql`excluded."isActive"`,
            demoBatchKey: sql`excluded."demoBatchKey"`,
            updatedAt: sql`excluded."updatedAt"`,
          },
          where: isNotNull(sapCatalog.demoBatchKey),
        });
    }

    articleStageProcessed += articleChunk.length;
    await reportProgress({
      stage: "articles",
      stageLabel: "Actualizando catalogo SAP",
      currentStageProcessed: articleStageProcessed,
      currentStageTotal: catalogArticles.length,
      increment: articleChunk.length,
    });
  }

  let inventoryStageProcessed = 0;
  await reportProgress({
    stage: "inventory",
    stageLabel: "Cargando inventario por almacen",
    currentStageProcessed: 0,
    currentStageTotal: payload.articles.length,
  });

  for (const inventoryChunk of chunkItems(
    payload.articles,
    DEMO_IMPORT_BATCH_SIZE
  )) {
    if (inventoryChunk.length === 0) continue;

    const articleCodes = Array.from(
      new Set(inventoryChunk.map(article => article.itemCode))
    );
    const existingInventory = await db
      .select()
      .from(inventoryItems)
      .where(inArray(inventoryItems.sapItemCode, articleCodes));

    const existingInventoryMap = new Map(
      existingInventory.map(item => [
        `${item.sapItemCode}::${item.warehouseLocation ?? ""}`,
        item,
      ])
    );

    const inventoryToInsert: InsertInventoryItem[] = [];

    for (const article of inventoryChunk) {
      const matchedWarehouse = article.warehouseLocation
        ? importedWarehouseMap.get(
            normalizeWarehouseLocationKey(article.warehouseLocation)
          )
        : undefined;
      const resolvedWarehouseLocation =
        matchedWarehouse?.displayName ?? article.warehouseLocation;
      const inventoryKey = `${article.itemCode}::${resolvedWarehouseLocation ?? ""}`;
      const existingItem = existingInventoryMap.get(inventoryKey);

      if (existingItem && !existingItem.demoBatchKey) {
        inventorySummary.skipped += 1;
        continue;
      }

      if (existingItem) {
        const updateData: Partial<InsertInventoryItem> = {
          name: article.description,
          description: article.fullDescription ?? article.description,
          warehouseId: matchedWarehouse?.id ?? null,
          warehouseLocation: resolvedWarehouseLocation,
          isActive: true,
          demoBatchKey: batchKey,
          updatedAt: new Date(),
        };

        if (article.stock !== undefined) {
          updateData.currentStock = article.stock;
        }

        await db
          .update(inventoryItems)
          .set(updateData)
          .where(eq(inventoryItems.id, existingItem.id));
        inventorySummary.updated += 1;
        continue;
      }

      inventoryToInsert.push({
        sapItemCode: article.itemCode,
        name: article.description,
        description: article.fullDescription ?? article.description,
        currentStock: article.stock ?? "0",
        warehouseId: matchedWarehouse?.id ?? null,
        warehouseLocation: resolvedWarehouseLocation,
        isActive: true,
        demoBatchKey: batchKey,
      });
      inventorySummary.inserted += 1;
    }

    if (inventoryToInsert.length > 0) {
      await db.insert(inventoryItems).values(inventoryToInsert);
    }

    inventoryStageProcessed += inventoryChunk.length;
    await reportProgress({
      stage: "inventory",
      stageLabel: "Cargando inventario por almacen",
      currentStageProcessed: inventoryStageProcessed,
      currentStageTotal: payload.articles.length,
      increment: inventoryChunk.length,
    });
  }

  let supplierStageProcessed = 0;
  await reportProgress({
    stage: "suppliers",
    stageLabel: "Actualizando proveedores",
    currentStageProcessed: 0,
    currentStageTotal: payload.suppliers.length,
  });

  for (const supplierChunk of chunkItems(
    payload.suppliers,
    DEMO_IMPORT_BATCH_SIZE
  )) {
    if (supplierChunk.length === 0) continue;

    const supplierCodes = supplierChunk.map(supplier => supplier.supplierCode);
    const existingSuppliers = await db
      .select()
      .from(suppliers)
      .where(inArray(suppliers.supplierCode, supplierCodes));

    const existingSuppliersMap = new Map(
      existingSuppliers.map(supplier => [supplier.supplierCode, supplier])
    );

    const suppliersToPersist: InsertSupplier[] = [];

    for (const supplier of supplierChunk) {
      const existingSupplier = existingSuppliersMap.get(supplier.supplierCode);
      const insertPayload: InsertSupplier = {
        supplierCode: supplier.supplierCode,
        name: supplier.name,
        isActive: true,
        demoBatchKey: batchKey,
        updatedAt: new Date(),
      };

      if (existingSupplier && !existingSupplier.demoBatchKey) {
        supplierSummary.skipped += 1;
        continue;
      }

      if (existingSupplier) {
        supplierSummary.updated += 1;
      } else {
        supplierSummary.inserted += 1;
      }

      suppliersToPersist.push(insertPayload);
    }

    if (suppliersToPersist.length > 0) {
      await db
        .insert(suppliers)
        .values(suppliersToPersist)
        .onConflictDoUpdate({
          target: suppliers.supplierCode,
          set: {
            name: sql`excluded."name"`,
            isActive: sql`excluded."isActive"`,
            demoBatchKey: sql`excluded."demoBatchKey"`,
            updatedAt: sql`excluded."updatedAt"`,
          },
          where: isNotNull(suppliers.demoBatchKey),
        });
    }

    supplierStageProcessed += supplierChunk.length;
    await reportProgress({
      stage: "suppliers",
      stageLabel: "Actualizando proveedores",
      currentStageProcessed: supplierStageProcessed,
      currentStageTotal: payload.suppliers.length,
      increment: supplierChunk.length,
    });
  }

  return {
    batchKey,
    projects: projectSummary,
    articles: articleSummary,
    inventoryRows: inventorySummary,
    suppliers: supplierSummary,
  };
}

export async function clearDemoData() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return db.transaction(async tx => {
    const demoProjects = await tx
      .select()
      .from(projects)
      .where(isNotNull(projects.demoBatchKey));

    const projectIds = demoProjects.map(project => project.id);

    if (projectIds.length > 0) {
      await tx
        .delete(userProjectAssignments)
        .where(inArray(userProjectAssignments.projectId, projectIds));

      await tx
        .delete(invitationProjectAssignments)
        .where(inArray(invitationProjectAssignments.projectId, projectIds));

      await tx
        .update(users)
        .set({ assignedProjectId: null })
        .where(inArray(users.assignedProjectId, projectIds));

      await tx
        .update(invitations)
        .set({ assignedProjectId: null })
        .where(inArray(invitations.assignedProjectId, projectIds));
    }

    const deletedProjects = await tx
      .delete(projects)
      .where(isNotNull(projects.demoBatchKey))
      .returning({ id: projects.id });

    const deletedArticles = await tx
      .delete(sapCatalog)
      .where(isNotNull(sapCatalog.demoBatchKey))
      .returning({ id: sapCatalog.id });

    const deletedInventory = await tx
      .delete(inventoryItems)
      .where(isNotNull(inventoryItems.demoBatchKey))
      .returning({ id: inventoryItems.id });

    const deletedSuppliers = await tx
      .delete(suppliers)
      .where(isNotNull(suppliers.demoBatchKey))
      .returning({ id: suppliers.id });

    return {
      projects: deletedProjects.length,
      articles: deletedArticles.length,
      inventoryRows: deletedInventory.length,
      suppliers: deletedSuppliers.length,
    };
  });
}
