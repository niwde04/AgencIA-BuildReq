import { eq, and, desc, asc, sql, count, ilike, or, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser,
  users,
  projects,
  materialRequests,
  requestItems,
  supplyFlowRecords,
  purchaseRequests,
  purchaseRequestItems,
  purchaseOrders,
  purchaseOrderItems,
  transferRequests,
  transferRequestItems,
  transfers,
  remissionGuides,
  receipts,
  receiptItems,
  openingBalances,
  openingBalanceItems,
  reverseLogistics,
  reverseLogisticsItems,
  attachments,
  notifications,
  inventoryItems,
  sapSyncLog,
  invitations,
  sapCatalog,
  suppliers,
  warehouses,
} from "../drizzle/schema";
import type {
  InsertProject,
  InsertMaterialRequest,
  InsertRequestItem,
  InsertSupplyFlowRecord,
  InsertPurchaseRequest,
  InsertPurchaseRequestItem,
  InsertPurchaseOrder,
  InsertPurchaseOrderItem,
  InsertTransferRequest,
  InsertTransferRequestItem,
  InsertTransfer,
  InsertRemissionGuide,
  InsertReceipt,
  InsertReceiptItem,
  InsertOpeningBalance,
  InsertOpeningBalanceItem,
  InsertReverseLogistic,
  InsertReverseLogisticItem,
  InsertAttachment,
  InsertNotification,
  InsertInventoryItem,
  InventoryItem,
  InsertSapSyncLogEntry,
  InsertInvitation,
  InsertSapCatalogItem,
  InsertSupplier,
  InsertWarehouse,
  Warehouse,
  OpeningBalance,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  buildEmailPreview,
  buildProcurementPdfBase64,
  buildSimplePdfBase64,
} from "./_core/documents";
import {
  calculatePurchaseOrderLineAmounts,
  formatPurchaseOrderCurrency,
  getPurchaseOrderTaxMeta,
  summarizePurchaseOrderLines,
} from "@shared/purchase-orders";
import {
  getDemoImportWorkload,
  type ParsedDemoImportPayload,
} from "./_core/demoData";

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

type BuildReqRole =
  | "ingeniero_residente"
  | "jefe_bodega_central"
  | "administracion_central"
  | "administrador_proyecto";

function parseDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const normalized = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function toDecimalString(value: string | number | null | undefined) {
  return parseDecimal(value).toFixed(2);
}

function formatDateLabel(date: Date | string | null | undefined) {
  if (!date) return "Sin fecha";
  return new Date(date).toLocaleDateString("es-HN");
}

function buildPurchaseOrderSummaryRows(items: Array<{
  quantity: string | number | null | undefined;
  unitPrice?: string | number | null;
  taxCode?: string | null;
}>) {
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
export async function upsertUser(user: InsertUser): Promise<void> {
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
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
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
  assignedProjectId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(users)
    .set({ buildreqRole, assignedProjectId: assignedProjectId ?? null })
    .where(eq(users.id, userId));
  return { success: true };
}

// ============================================================
// PROJECTS
// ============================================================
function mapProjectWithWarehouse(row: {
  project: typeof projects.$inferSelect;
  warehouse: typeof warehouses.$inferSelect | null;
}) {
  return {
    ...row.project,
    warehouse: row.warehouse
      ? {
          id: row.warehouse.id,
          code: row.warehouse.code,
          name: row.warehouse.name,
          displayName: row.warehouse.displayName,
          isActive: row.warehouse.isActive,
        }
      : null,
  };
}

export async function listProjects(statusFilter?: string) {
  const db = await getDb();
  if (!db) return [];
  const where = statusFilter
    ? eq(projects.status, statusFilter as any)
    : undefined;

  const rows = await db
    .select({
      project: projects,
      warehouse: warehouses,
    })
    .from(projects)
    .leftJoin(warehouses, eq(warehouses.projectId, projects.id))
    .where(where)
    .orderBy(desc(projects.createdAt));

  return rows.map(mapProjectWithWarehouse);
}

export async function getProjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({
      project: projects,
      warehouse: warehouses,
    })
    .from(projects)
    .leftJoin(warehouses, eq(warehouses.projectId, projects.id))
    .where(eq(projects.id, id))
    .limit(1);
  return result[0] ? mapProjectWithWarehouse(result[0]) : undefined;
}

export async function getProjectByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({
      project: projects,
      warehouse: warehouses,
    })
    .from(projects)
    .leftJoin(warehouses, eq(warehouses.projectId, projects.id))
    .where(eq(projects.code, code))
    .limit(1);
  return result[0] ? mapProjectWithWarehouse(result[0]) : undefined;
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [project] = await db.insert(projects).values(data).returning();
  const warehouse = await ensureProjectWarehouse(project.id);
  return {
    id: project.id,
    warehouseId: warehouse.id,
  };
}

export async function updateProject(id: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(projects).set(data).where(eq(projects.id, id));
  const warehouse = await ensureProjectWarehouse(id);
  await syncInventoryItemsToProjectWarehouse(id, warehouse);
  return { success: true };
}

// ============================================================
// MATERIAL REQUESTS
// ============================================================
export async function generateRequestNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(materialRequests)
    .where(sql`EXTRACT(YEAR FROM ${materialRequests.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `REQ-${year}-${String(num).padStart(4, "0")}`;
}

export async function createMaterialRequest(
  data: Omit<InsertMaterialRequest, "requestNumber">,
  items: Omit<InsertRequestItem, "requestId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const isService = data.requestType === "servicios";
  const recipient = data.recipient ??
    (isService ? "administrador_proyecto" : "bodega_proyecto");
  const workflowStage = data.workflowStage ??
    (isService ? "administrador_proyecto" : "bodega_proyecto");
  const approvalStatus = data.approvalStatus ??
    (isService ? "pendiente" : "no_requiere");
  const requestNumber = await generateRequestNumber();
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
    await db.insert(requestItems).values(
      items.map((item) => ({ ...item, requestId }))
    );
  }

  return { id: requestId, requestNumber };
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
      items.map((item) => ({
        ...item,
        requestId,
      }))
    );
  }

  return { success: true };
}

export async function listMaterialRequests(filters?: {
  projectId?: number;
  status?: string;
  requestedById?: number;
  requestType?: string;
  workflowStage?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.projectId) conditions.push(eq(materialRequests.projectId, filters.projectId));
  if (filters?.status) conditions.push(eq(materialRequests.status, filters.status as any));
  if (filters?.requestedById) conditions.push(eq(materialRequests.requestedById, filters.requestedById));
  if (filters?.requestType) conditions.push(eq(materialRequests.requestType, filters.requestType as any));
  if (filters?.workflowStage) conditions.push(eq(materialRequests.workflowStage, filters.workflowStage as any));

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

  return rows;
}

async function getCommittedQuantityForItem(
  requestId: number,
  item: { sapItemCode?: string | null; itemName: string }
) {
  const db = await getDb();
  if (!db) return "0.00";

  const matchCondition = item.sapItemCode
    ? eq(requestItems.sapItemCode, item.sapItemCode)
    : sql`lower(${requestItems.itemName}) = lower(${item.itemName})`;

  const rows = await db
    .select({
      quantity: requestItems.quantity,
      deliveredQuantity: requestItems.deliveredQuantity,
    })
    .from(requestItems)
    .leftJoin(materialRequests, eq(requestItems.requestId, materialRequests.id))
    .where(
      and(
        matchCondition,
        sql`${requestItems.requestId} <> ${requestId}`,
        inArray(materialRequests.status, [
          "pendiente_aprobar",
          "en_espera",
          "en_proceso",
        ])
      )
    );

  const total = rows.reduce((sum, row) => {
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
}) {
  const db = await getDb();
  if (!db) return "0.00";

  const conditions = [];
  if (params.sapItemCode) {
    conditions.push(eq(inventoryItems.sapItemCode, params.sapItemCode));
  } else {
    conditions.push(sql`lower(${inventoryItems.name}) = lower(${params.itemName})`);
  }
  if (params.projectId) {
    conditions.push(eq(inventoryItems.projectId, params.projectId));
  }

  const rows = await db
    .select({ currentStock: inventoryItems.currentStock })
    .from(inventoryItems)
    .where(and(...conditions));

  const total = rows.reduce((sum, row) => sum + parseDecimal(row.currentStock), 0);
  return toDecimalString(total);
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

  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const committedQuantity = await getCommittedQuantityForItem(id, item);
      const sapStock = await getStockByItem({
        sapItemCode: item.sapItemCode,
        itemName: item.itemName,
      });
      const projectStock = await getStockByItem({
        sapItemCode: item.sapItemCode,
        itemName: item.itemName,
        projectId: rows[0]?.request.projectId ?? null,
      });

      return {
        ...item,
        committedQuantity:
          item.committedQuantity ?? committedQuantity,
        sapStock: item.sapStock ?? sapStock,
        projectStock: item.projectStock ?? projectStock,
        dispatchedQuantity: item.dispatchedQuantity ?? item.deliveredQuantity ?? "0.00",
      };
    })
  );

  return { ...rows[0], items: enrichedItems };
}

export async function updateMaterialRequestStatus(
  id: number,
  status:
    | "borrador"
    | "pendiente_aprobar"
    | "en_espera"
    | "en_proceso"
    | "cerrada"
    | "anulada",
  processedById?: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const updateData: Record<string, unknown> = { status };
  if (processedById) updateData.processedById = processedById;
  if (status === "en_proceso") updateData.processedAt = new Date();
  if (status === "cerrada") updateData.closedAt = new Date();
  if (status === "cerrada") updateData.workflowStage = "cerrada";
  if (status === "anulada") updateData.workflowStage = "rechazada";

  await db.update(materialRequests).set(updateData).where(eq(materialRequests.id, id));
  return { success: true };
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

  return syncMaterialRequestApprovalState(params.requestId, params.approvedById);
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

  const pendingCount = items.filter((item) => item.approvalStatus === "pendiente").length;
  const approvedCount = items.filter(
    (item) =>
      item.approvalStatus === "aprobada" || item.approvalStatus === "no_requiere"
  ).length;
  const rejectedCount = items.filter((item) => item.approvalStatus === "rechazada").length;
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
  flowType: "compra_directa" | "despacho_bodega" | "traslado_proyecto" | "solicitud_compra",
  processedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(materialRequests)
    .set({ assignedFlow: flowType, processedById, processedAt: new Date(), status: "en_proceso" })
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
  return db.select().from(requestItems).where(eq(requestItems.requestId, requestId));
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

export async function recordWarehouseExit(params: {
  requestId: number;
  requestItemId: number;
  quantity: string;
  note?: string;
  processedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [item] = await db
    .select()
    .from(requestItems)
    .where(eq(requestItems.id, params.requestItemId))
    .limit(1);
  const [request] = await db
    .select({
      projectId: materialRequests.projectId,
    })
    .from(materialRequests)
    .where(eq(materialRequests.id, params.requestId))
    .limit(1);

  if (!item || !request) {
    throw new Error("Ítem de requisición no encontrado");
  }

  const requested = parseDecimal(item.quantity);
  const dispatched = parseDecimal(params.quantity);
  const nextStatus =
    dispatched <= 0 ? "pendiente" : dispatched < requested ? "parcial" : "completo";

  await consumeInventoryStock({
    sapItemCode: item.sapItemCode,
    itemName: item.sapItemDescription || item.itemName,
    projectId: request.projectId,
    quantity: dispatched,
  });

  await db
    .update(requestItems)
    .set({
      dispatchedQuantity: toDecimalString(dispatched),
      deliveredQuantity: toDecimalString(dispatched),
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
        eq(supplyFlowRecords.requestId, params.requestId),
        eq(supplyFlowRecords.requestItemId, params.requestItemId),
        eq(supplyFlowRecords.flowType, "despacho_bodega")
      )
    )
    .limit(1);

  if (existingFlow) {
    await db
      .update(supplyFlowRecords)
      .set({
        notes: params.note ?? existingFlow.notes,
        status: dispatched < requested ? "en_proceso" : "completado",
        updatedAt: new Date(),
      })
      .where(eq(supplyFlowRecords.id, existingFlow.id));
  } else {
    await db.insert(supplyFlowRecords).values({
      requestId: params.requestId,
      requestItemId: params.requestItemId,
      flowType: "despacho_bodega",
      sourceWarehouse: "Bodega del Proyecto",
      sapDocumentType: "salida_inventario",
      processedById: params.processedById,
      notes: params.note,
      status: dispatched < requested ? "en_proceso" : "completado",
    });
  }

  return { success: true, status: nextStatus };
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

export async function updateSupplyFlowRecord(
  id: number,
  data: Partial<InsertSupplyFlowRecord>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(supplyFlowRecords).set(data).where(eq(supplyFlowRecords.id, id));
  return { success: true };
}

export async function listSupplyFlowRecords(filters?: {
  flowType?: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.flowType) conditions.push(eq(supplyFlowRecords.flowType, filters.flowType as any));
  if (filters?.status) conditions.push(eq(supplyFlowRecords.status, filters.status as any));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      flow: supplyFlowRecords,
      request: materialRequests,
      project: projects,
    })
    .from(supplyFlowRecords)
    .leftJoin(materialRequests, eq(supplyFlowRecords.requestId, materialRequests.id))
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .where(where)
    .orderBy(desc(supplyFlowRecords.createdAt));
}

export async function getActiveSupplyFlowForRequestItem(params: {
  requestId: number;
  requestItemId: number;
  flowType: "compra_directa" | "despacho_bodega" | "traslado_proyecto" | "solicitud_compra";
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
export async function generatePurchaseOrderNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const [legacyResult, orderResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(supplyFlowRecords)
      .where(
        and(
          sql`EXTRACT(YEAR FROM ${supplyFlowRecords.createdAt}) = ${year}`,
          sql`${supplyFlowRecords.purchaseOrderNumber} IS NOT NULL`
        )
      ),
    db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(sql`EXTRACT(YEAR FROM ${purchaseOrders.createdAt}) = ${year}`),
  ]);
  const num =
    (legacyResult[0]?.count ?? 0) + (orderResult[0]?.count ?? 0) + 1;
  return `OC-${year}-${String(num).padStart(4, "0")}`;
}

export async function generatePurchaseRequestNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(purchaseRequests)
    .where(sql`EXTRACT(YEAR FROM ${purchaseRequests.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `SC-${year}-${String(num).padStart(4, "0")}`;
}

export async function generateTransferRequestNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(transferRequests)
    .where(sql`EXTRACT(YEAR FROM ${transferRequests.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `ST-${year}-${String(num).padStart(4, "0")}`;
}

export async function generateTransferNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(transfers)
    .where(sql`EXTRACT(YEAR FROM ${transfers.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `TR-${year}-${String(num).padStart(4, "0")}`;
}

export async function generateRemissionGuideNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(remissionGuides)
    .where(sql`EXTRACT(YEAR FROM ${remissionGuides.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `GR-${year}-${String(num).padStart(4, "0")}`;
}

export async function generateReceiptNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(receipts)
    .where(sql`EXTRACT(YEAR FROM ${receipts.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `REC-${year}-${String(num).padStart(4, "0")}`;
}

export async function generateOpeningBalanceNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(openingBalances)
    .where(sql`EXTRACT(YEAR FROM ${openingBalances.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `SI-${year}-${String(num).padStart(4, "0")}`;
}

function buildPurchaseRequestDocument(params: {
  requestNumber: string;
  projectLabel: string;
  purchaseType: string;
  neededBy: Date | string | null | undefined;
  printedAt?: Date | string | null | undefined;
  items: Array<{ itemName: string; quantity: string | number; unit?: string | null }>;
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
    items: params.items.map((item) => ({
      description: item.itemName,
      quantityLabel: `${item.quantity} ${item.unit ?? ""}`.trim(),
    })),
    generatedLabel: formatDateLabel(params.printedAt ?? new Date()),
    footerNote: "Solicitud generada automáticamente por BuildReq.",
  });
}

function buildPurchaseOrderDocument(params: {
  orderNumber: string;
  classification: string;
  status?: string | null;
  projectLabel: string;
  supplierLabel: string;
  neededBy: Date | string | null | undefined;
  printedAt?: Date | string | null | undefined;
  items: Array<{
    itemName: string;
    currentSapItemCode?: string | null;
    quantity: string | number;
    unit?: string | null;
    unitPrice?: string | number | null;
    taxCode?: string | null;
  }>;
}) {
  const isDraft =
    !params.status ||
    !["emitida", "enviada", "parcialmente_recibida", "recibida"].includes(params.status);

  return buildProcurementPdfBase64({
    title: "Orden de Compra",
    documentNumber: params.orderNumber,
    badgeText: params.classification.toUpperCase(),
    primaryFields: [
      {
        label: "Proyecto",
        value: params.projectLabel,
      },
      {
        label: "Proveedor",
        value: params.supplierLabel,
      },
    ],
    secondaryFields: [
      {
        label: "Clasificación",
        value: params.classification.toUpperCase(),
      },
      {
        label: "Fecha necesaria",
        value: formatDateLabel(params.neededBy),
      },
      {
        label: "Generado",
        value: formatDateLabel(params.printedAt ?? new Date()),
      },
    ],
    items: params.items.map((item) => ({
      description: item.itemName,
      quantityLabel: `${item.quantity} ${item.unit ?? ""}`.trim(),
      amountLabel: formatPurchaseOrderCurrency(
        calculatePurchaseOrderLineAmounts({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxCode: item.taxCode,
        }).total
      ),
      metaLines: [
        ...(item.currentSapItemCode ? [`SAP: ${item.currentSapItemCode}`] : []),
        [
          `Precio unitario: ${formatPurchaseOrderCurrency(item.unitPrice)}`,
          `Impuesto: ${getPurchaseOrderTaxMeta(item.taxCode).shortLabel}`,
          `Total linea: ${formatPurchaseOrderCurrency(
            calculatePurchaseOrderLineAmounts({
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxCode: item.taxCode,
            }).total
          )}`,
        ].join(" | "),
      ],
    })),
    summaryRows: buildPurchaseOrderSummaryRows(params.items),
    generatedLabel: formatDateLabel(params.printedAt ?? new Date()),
    footerNote: isDraft
      ? "Documento generado en borrador por BuildReq."
      : "Orden emitida automáticamente por BuildReq.",
    watermarkText: isDraft ? "BORRADOR" : undefined,
  });
}

export async function createPurchaseRequest(
  data: Omit<InsertPurchaseRequest, "requestNumber">,
  items: Omit<InsertPurchaseRequestItem, "purchaseRequestId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const requestNumber = await generatePurchaseRequestNumber();
  const project = await getProjectById(data.projectId);
  const printedDocumentContent = buildPurchaseRequestDocument({
    requestNumber,
    projectLabel: project ? `${project.code} - ${project.name}` : `Proyecto ${data.projectId}`,
    purchaseType: data.purchaseType === "local" ? "Compra Local" : "Compra Extranjera",
    neededBy: data.neededBy,
    printedAt: new Date(),
    items: items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
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

  if (items.length > 0) {
    await db.insert(purchaseRequestItems).values(
      items.map((item) => ({
        ...item,
        purchaseRequestId: created.id,
      }))
    );
  }

  return { id: created.id, requestNumber };
}

export async function listPurchaseRequests(filters?: {
  projectId?: number;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId) conditions.push(eq(purchaseRequests.projectId, filters.projectId));
  if (filters?.status) conditions.push(eq(purchaseRequests.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      purchaseRequest: purchaseRequests,
      project: projects,
      materialRequest: materialRequests,
    })
    .from(purchaseRequests)
    .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
    .leftJoin(materialRequests, eq(purchaseRequests.materialRequestId, materialRequests.id))
    .where(where)
    .orderBy(desc(purchaseRequests.createdAt));
}

export async function getPurchaseRequestById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      purchaseRequest: purchaseRequests,
      project: projects,
      materialRequest: materialRequests,
    })
    .from(purchaseRequests)
    .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
    .leftJoin(materialRequests, eq(purchaseRequests.materialRequestId, materialRequests.id))
    .where(eq(purchaseRequests.id, id))
    .limit(1);

  if (!rows[0]) return undefined;
  const items = await db
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.purchaseRequestId, id));

  const printedDocumentContent = buildPurchaseRequestDocument({
    requestNumber: rows[0].purchaseRequest.requestNumber,
    projectLabel: rows[0].project
      ? `${rows[0].project.code} - ${rows[0].project.name}`
      : `Proyecto ${rows[0].purchaseRequest.projectId}`,
    purchaseType:
      rows[0].purchaseRequest.purchaseType === "local"
        ? "Compra Local"
        : "Compra Extranjera",
    neededBy: rows[0].purchaseRequest.neededBy,
    printedAt: rows[0].purchaseRequest.printedAt,
    items: items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
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

export async function rejectPurchaseRequest(id: number, rejectionReason: string) {
  return updatePurchaseRequest(id, {
    status: "rechazada",
    rejectionReason,
  });
}

export async function createPurchaseOrder(
  data: Omit<InsertPurchaseOrder, "orderNumber">,
  items: Omit<InsertPurchaseOrderItem, "purchaseOrderId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const orderNumber = await generatePurchaseOrderNumber();
  const project = await getProjectById(data.projectId);
  const supplier = data.supplierId ? await getSupplierById(data.supplierId) : null;
  const printedDocumentContent = buildPurchaseOrderDocument({
    orderNumber,
    classification: data.classification ?? "oc",
    status: data.status ?? "emitida",
    projectLabel: project ? `${project.code} - ${project.name}` : `Proyecto ${data.projectId}`,
    supplierLabel: supplier?.name ?? "Proveedor pendiente",
    neededBy: data.neededBy,
    printedAt: new Date(),
    items: items.map((item) => ({
      itemName: item.itemName,
      currentSapItemCode: item.currentSapItemCode,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
    })),
  });

  const [created] = await db
    .insert(purchaseOrders)
    .values({
      ...data,
      orderNumber,
      printedDocumentName: `${orderNumber}.pdf`,
      printedDocumentMimeType: "application/pdf",
      printedDocumentContent,
      printedAt: new Date(),
      supplierEmail: data.supplierEmail ?? supplier?.email ?? null,
      status: data.status ?? "emitida",
    })
    .returning({ id: purchaseOrders.id });

  if (items.length > 0) {
    await db.insert(purchaseOrderItems).values(
      items.map((item) => ({
        ...item,
        purchaseOrderId: created.id,
      }))
    );
  }

  return { id: created.id, orderNumber };
}

export async function listPurchaseOrders(filters?: {
  projectId?: number;
  classification?: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId) conditions.push(eq(purchaseOrders.projectId, filters.projectId));
  if (filters?.classification) {
    conditions.push(eq(purchaseOrders.classification, filters.classification as any));
  }
  if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      purchaseOrder: purchaseOrders,
      purchaseRequest: purchaseRequests,
      project: projects,
      supplier: suppliers,
    })
    .from(purchaseOrders)
    .leftJoin(purchaseRequests, eq(purchaseOrders.purchaseRequestId, purchaseRequests.id))
    .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt));
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
    })
    .from(purchaseOrders)
    .leftJoin(purchaseRequests, eq(purchaseOrders.purchaseRequestId, purchaseRequests.id))
    .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!rows[0]) return undefined;
  const items = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, id));

  const printedDocumentContent = buildPurchaseOrderDocument({
    orderNumber: rows[0].purchaseOrder.orderNumber,
    classification: rows[0].purchaseOrder.classification,
    status: rows[0].purchaseOrder.status,
    projectLabel: rows[0].project
      ? `${rows[0].project.code} - ${rows[0].project.name}`
      : `Proyecto ${rows[0].purchaseOrder.projectId}`,
    supplierLabel: rows[0].supplier?.name ?? "Proveedor pendiente",
    neededBy: rows[0].purchaseOrder.neededBy,
    printedAt: rows[0].purchaseOrder.printedAt,
    items: items.map((item) => ({
      itemName: item.itemName,
      currentSapItemCode: item.currentSapItemCode,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
    })),
  });

  const summary = summarizePurchaseOrderLines(
    items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxCode: item.taxCode,
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
  };
}

export async function updatePurchaseOrder(
  id: number,
  data: Partial<InsertPurchaseOrder>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(purchaseOrders)
    .set({ ...data, updatedAt: new Date() })
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

export async function getPurchaseOrderItemById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      item: purchaseOrderItems,
      purchaseOrder: purchaseOrders,
    })
    .from(purchaseOrderItems)
    .leftJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
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
  const requestNumber = await generateTransferRequestNumber();
  const [created] = await db
    .insert(transferRequests)
    .values({ ...data, requestNumber })
    .returning({ id: transferRequests.id });

  if (items.length > 0) {
    await db.insert(transferRequestItems).values(
      items.map((item) => ({
        ...item,
        transferRequestId: created.id,
      }))
    );
  }

  return { id: created.id, requestNumber };
}

export async function listTransferRequests(filters?: {
  projectId?: number;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId) conditions.push(eq(transferRequests.projectId, filters.projectId));
  if (filters?.status) conditions.push(eq(transferRequests.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      transferRequest: transferRequests,
      project: projects,
      materialRequest: materialRequests,
    })
    .from(transferRequests)
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(materialRequests, eq(transferRequests.materialRequestId, materialRequests.id))
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
    .leftJoin(materialRequests, eq(transferRequests.materialRequestId, materialRequests.id))
    .where(eq(transferRequests.id, id))
    .limit(1);
  if (!rows[0]) return undefined;
  const items = await db
    .select()
    .from(transferRequestItems)
    .where(eq(transferRequestItems.transferRequestId, id));
  return { ...rows[0], items };
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
  confirmedById: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const detail = await getTransferRequestById(transferRequestId);
  if (!detail) throw new Error("Solicitud de traslado no encontrada");

  for (const item of detail.items || []) {
    await consumeInventoryStock({
      sapItemCode: item.sapItemCode,
      itemName: item.itemName,
      projectId: detail.transferRequest.projectId,
      quantity: item.quantity,
    });
  }

  const transferNumber = await generateTransferNumber();
  const guideNumber = await generateRemissionGuideNumber();
  const sapCorrelative = `SAP-${guideNumber}`;
  const documentContent = buildSimplePdfBase64(`Guía de Remisión ${guideNumber}`, [
    `Traslado: ${transferNumber}`,
    `Solicitud de traslado: ${detail.transferRequest.requestNumber}`,
    `Proyecto origen: ${detail.project?.code ?? detail.transferRequest.projectId}`,
    `Destino: ${
      detail.transferRequest.destinationType === "bodega_central"
        ? "Bodega Central"
        : `Proyecto ${detail.transferRequest.destinationProjectId ?? ""}`
    }`,
    `Correlativo SAP: ${sapCorrelative}`,
  ]);

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

  await updateTransferRequest(transferRequestId, { status: "convertida" });
  return { id: transfer.id, transferNumber, guideNumber, sapCorrelative };
}

export async function listTransfers(filters?: { status?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.status) conditions.push(eq(transfers.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select({
      transfer: transfers,
      transferRequest: transferRequests,
      project: projects,
    })
    .from(transfers)
    .leftJoin(transferRequests, eq(transfers.transferRequestId, transferRequests.id))
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .where(where)
    .orderBy(desc(transfers.createdAt));
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
    })
    .from(transfers)
    .leftJoin(transferRequests, eq(transfers.transferRequestId, transferRequests.id))
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(remissionGuides, eq(remissionGuides.transferId, transfers.id))
    .where(eq(transfers.id, id))
    .limit(1);
  if (!rows[0]) return undefined;
  const items = await db
    .select()
    .from(transferRequestItems)
    .where(eq(transferRequestItems.transferRequestId, rows[0].transferRequest?.id ?? 0));
  return { ...rows[0], items };
}

export async function registerReceipt(
  data: Omit<InsertReceipt, "receiptNumber">,
  items: Omit<InsertReceiptItem, "receiptId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const receiptNumber = await generateReceiptNumber();
  const totalExpected = items.reduce(
    (sum, item) => sum + parseDecimal(item.quantityExpected),
    0
  );
  const totalReceived = items.reduce(
    (sum, item) => sum + parseDecimal(item.quantityReceived),
    0
  );
  const status =
    totalReceived === 0
      ? "pendiente"
      : totalReceived < totalExpected
      ? "parcial"
      : "completa";

  const [created] = await db
    .insert(receipts)
    .values({
      ...data,
      receiptNumber,
      status,
    })
    .returning({ id: receipts.id });

  if (items.length > 0) {
    await db.insert(receiptItems).values(
      items.map((item) => ({
        ...item,
        receiptId: created.id,
      }))
    );
  }

  if (data.sourceType === "purchase_order") {
    const purchaseOrderDetail = await getPurchaseOrderById(data.sourceId);
    if (!purchaseOrderDetail) {
      throw new Error("Orden de compra no encontrada");
    }

    for (const item of items) {
      const [existingItem] = await db
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.id, item.sourceItemId))
        .limit(1);
      if (!existingItem) continue;
      const nextReceived =
        parseDecimal(existingItem.receivedQuantity) + parseDecimal(item.quantityReceived);
      await updatePurchaseOrderItem(existingItem.id, {
        receivedQuantity: toDecimalString(nextReceived),
      });

      await addInventoryStock({
        sapItemCode:
          existingItem.currentSapItemCode ?? existingItem.originalSapItemCode,
        itemName: existingItem.itemName,
        unit: existingItem.unit,
        projectId: purchaseOrderDetail.purchaseOrder.projectId,
        quantity: item.quantityReceived,
      });
    }
    await updatePurchaseOrder(data.sourceId, {
      status: status === "completa" ? "recibida" : "parcialmente_recibida",
    });
  } else {
    const transferDetail = await getTransferById(data.sourceId);
    if (transferDetail?.transfer) {
      const destinationProjectId =
        transferDetail.transferRequest?.destinationType === "proyecto"
          ? transferDetail.transferRequest.destinationProjectId
          : null;

      for (const item of items) {
        const [existingItem] = await db
          .select()
          .from(transferRequestItems)
          .where(eq(transferRequestItems.id, item.sourceItemId))
          .limit(1);
        if (!existingItem) continue;

        const nextReceived =
          parseDecimal(existingItem.receivedQuantity) +
          parseDecimal(item.quantityReceived);

        await db
          .update(transferRequestItems)
          .set({
            receivedQuantity: toDecimalString(nextReceived),
            updatedAt: new Date(),
          })
          .where(eq(transferRequestItems.id, existingItem.id));

        await addInventoryStock({
          sapItemCode: existingItem.sapItemCode,
          itemName: existingItem.itemName,
          unit: existingItem.unit,
          projectId: destinationProjectId,
          quantity: item.quantityReceived,
        });
      }

      await db
        .update(transfers)
        .set({
          status:
            status === "completa" ? "recibido" : "parcialmente_recibido",
          updatedAt: new Date(),
        })
        .where(eq(transfers.id, data.sourceId));
    }
  }

  return { id: created.id, receiptNumber, status };
}

export async function listReceipts(filters?: {
  projectId?: number;
  sourceType?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId) conditions.push(eq(receipts.projectId, filters.projectId));
  if (filters?.sourceType) conditions.push(eq(receipts.sourceType, filters.sourceType as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select({
      receipt: receipts,
      project: projects,
    })
    .from(receipts)
    .leftJoin(projects, eq(receipts.projectId, projects.id))
    .where(where)
    .orderBy(desc(receipts.createdAt));
}

export async function getReceiptById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      receipt: receipts,
      project: projects,
    })
    .from(receipts)
    .leftJoin(projects, eq(receipts.projectId, projects.id))
    .where(eq(receipts.id, id))
    .limit(1);
  if (!rows[0]) return undefined;
  const items = await db
    .select()
    .from(receiptItems)
    .where(eq(receiptItems.receiptId, id));
  return { ...rows[0], items };
}

// ============================================================
// OPENING BALANCES
// ============================================================
export async function listOpeningBalances(filters?: { projectId?: number }) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.projectId) {
    conditions.push(eq(openingBalances.projectId, filters.projectId));
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
      projects.sapProjectCode,
      projects.demoBatchKey,
      projects.createdAt,
      projects.updatedAt,
      warehouses.id,
      warehouses.code,
      warehouses.name,
      warehouses.displayName,
      warehouses.projectId,
      warehouses.description,
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
    ({ openingBalance, project, warehouse, createdBy, itemCount, totalQuantity }) => ({
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

export async function createOpeningBalance(
  data: Omit<InsertOpeningBalance, "balanceNumber" | "warehouseId">,
  items: Omit<InsertOpeningBalanceItem, "openingBalanceId">[]
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

  const warehouse = await ensureProjectWarehouse(project.id);
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

  const balanceNumber = await generateOpeningBalanceNumber();
  const [created] = await db
    .insert(openingBalances)
    .values({
      ...data,
      balanceNumber,
      warehouseId: warehouse.id,
      openingDate: data.openingDate ?? new Date(),
    })
    .returning({ id: openingBalances.id });

  const normalizedItems = items.map((item) => ({
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

// ============================================================
// REVERSE LOGISTICS
// ============================================================
export async function generateReturnNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(reverseLogistics)
    .where(sql`EXTRACT(YEAR FROM ${reverseLogistics.createdAt}) = ${year}`);
  const num = (result[0]?.count ?? 0) + 1;
  return `DEV-${year}-${String(num).padStart(4, "0")}`;
}

export async function createReverseLogistic(
  data: Omit<InsertReverseLogistic, "returnNumber">,
  items: Omit<InsertReverseLogisticItem, "reverseLogisticId">[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const returnNumber = await generateReturnNumber();
  const [reverseLogistic] = await db
    .insert(reverseLogistics)
    .values({
      ...data,
      returnNumber,
    })
    .returning({ id: reverseLogistics.id });
  const reverseLogisticId = reverseLogistic.id;

  if (items.length > 0) {
    await db.insert(reverseLogisticsItems).values(
      items.map((item) => ({ ...item, reverseLogisticId }))
    );
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
  if (filters?.returnType) conditions.push(eq(reverseLogistics.returnType, filters.returnType as any));
  if (filters?.status) conditions.push(eq(reverseLogistics.status, filters.status as any));
  if (filters?.sourceProjectId) conditions.push(eq(reverseLogistics.sourceProjectId, filters.sourceProjectId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      return: reverseLogistics,
      sourceProject: projects,
    })
    .from(reverseLogistics)
    .leftJoin(projects, eq(reverseLogistics.sourceProjectId, projects.id))
    .where(where)
    .orderBy(desc(reverseLogistics.createdAt));
}

export async function getReverseLogisticById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db
    .select({
      return: reverseLogistics,
      sourceProject: projects,
    })
    .from(reverseLogistics)
    .leftJoin(projects, eq(reverseLogistics.sourceProjectId, projects.id))
    .where(eq(reverseLogistics.id, id))
    .limit(1);

  if (!rows[0]) return undefined;

  const items = await db
    .select()
    .from(reverseLogisticsItems)
    .where(eq(reverseLogisticsItems.reverseLogisticId, id));

  return { ...rows[0], items };
}

export async function updateReverseLogisticStatus(
  id: number,
  status: "pendiente" | "aprobada" | "en_transito" | "recibida" | "rechazada",
  processedById?: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const updateData: Record<string, unknown> = { status };
  if (processedById) {
    updateData.processedById = processedById;
    updateData.processedAt = new Date();
  }

  await db.update(reverseLogistics).set(updateData).where(eq(reverseLogistics.id, id));
  return { success: true };
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
  entityType:
    | "material_request"
    | "supply_flow"
    | "reverse_logistic"
    | "purchase_request"
    | "purchase_order"
    | "transfer_request"
    | "transfer"
    | "receipt",
  entityId: number
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
    .orderBy(desc(attachments.createdAt));
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
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return result[0]?.count ?? 0;
}

export async function markNotificationAsRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
  return { success: true };
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return { success: true };
}

// ============================================================
// WAREHOUSES
// ============================================================
type WarehouseSeedInput = {
  code: string;
  name: string;
  description?: string;
};

type ProjectWarehouseSource = {
  id: number;
  code: string;
  name: string;
  location?: string | null;
  status?: string | null;
};

function normalizeWarehouseCode(code: string) {
  return code.trim().toUpperCase();
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

function buildProjectWarehouseCode(projectId: number) {
  return `PRJ-${projectId}`;
}

function buildProjectWarehouseName(projectName: string) {
  return `Bodega ${normalizeWarehouseName(projectName)}`;
}

function buildProjectWarehouseDisplayName(projectCode: string, projectName: string) {
  return `${normalizeWarehouseName(projectCode).toUpperCase()} - ${normalizeWarehouseName(projectName).toUpperCase()} - BODEGA`;
}

function buildProjectWarehouseDescription(project: ProjectWarehouseSource) {
  const locationLabel = project.location?.trim();
  return locationLabel
    ? `Almacén operativo del proyecto ${project.code} en ${locationLabel}.`
    : `Almacén operativo del proyecto ${project.code}.`;
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

async function getProjectWarehouseByProjectId(projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.projectId, projectId))
    .limit(1);
  return rows[0];
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
    conditions.push(sql`lower(${inventoryItems.name}) = lower(${params.itemName})`);
  }

  if (params.projectId === null || params.projectId === undefined) {
    conditions.push(sql`${inventoryItems.projectId} IS NULL`);
  } else {
    conditions.push(eq(inventoryItems.projectId, params.projectId));
  }

  if (params.warehouseId) {
    conditions.push(eq(inventoryItems.warehouseId, params.warehouseId));
  } else if (params.warehouseLocation?.trim()) {
    conditions.push(eq(inventoryItems.warehouseLocation, params.warehouseLocation.trim()));
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

  const normalizedSapItemCode = params.sapItemCode?.trim() || null;
  const projectAssignment =
    params.projectId === null || params.projectId === undefined
      ? null
      : await resolveProjectAssignment(params.projectId);
  const warehouseAssignment = projectAssignment
    ? {
        warehouseId: projectAssignment.warehouseId,
        warehouseLocation: projectAssignment.warehouseLocation,
      }
    : await resolveWarehouseAssignment(
        params.warehouseId,
        params.warehouseLocation
      );

  const rows = await listInventoryRowsForStock({
    sapItemCode: normalizedSapItemCode,
    itemName: params.itemName,
    projectId: projectAssignment?.projectId ?? null,
    warehouseId: warehouseAssignment.warehouseId,
    warehouseLocation: warehouseAssignment.warehouseLocation,
  });
  const existingRow = rows[0];

  if (existingRow) {
    const nextStock =
      parseDecimal(existingRow.currentStock) + quantityToAdd;
    await db
      .update(inventoryItems)
      .set({
        name: existingRow.name || params.itemName,
        description: existingRow.description ?? params.description ?? null,
        unit: existingRow.unit ?? params.unit ?? null,
        projectId: projectAssignment?.projectId ?? null,
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
      projectId: projectAssignment?.projectId ?? null,
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

async function syncInventoryItemsToProjectWarehouse(
  projectId: number,
  warehouse: Warehouse
) {
  const db = await getDb();
  if (!db) return { linkedRows: 0 };

  const result = await db
    .update(inventoryItems)
    .set({
      warehouseId: warehouse.id,
      warehouseLocation: warehouse.displayName,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryItems.projectId, projectId),
        or(
          sql`${inventoryItems.warehouseId} IS DISTINCT FROM ${warehouse.id}`,
          sql`${inventoryItems.warehouseLocation} IS DISTINCT FROM ${warehouse.displayName}`
        )
      )
    )
    .returning({ id: inventoryItems.id });

  return {
    linkedRows: result.length,
  };
}

async function ensureProjectWarehouse(projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error("El proyecto seleccionado no existe");
  }

  const warehousePayload = {
    code: buildProjectWarehouseCode(project.id),
    name: buildProjectWarehouseName(project.name),
    displayName: buildProjectWarehouseDisplayName(project.code, project.name),
    description: buildProjectWarehouseDescription(project),
    projectId: project.id,
    isActive: project.status === "activo",
    updatedAt: new Date(),
  } satisfies InsertWarehouse;

  const existingWarehouse = await getProjectWarehouseByProjectId(project.id);

  if (existingWarehouse) {
    await db
      .update(warehouses)
      .set(warehousePayload)
      .where(eq(warehouses.id, existingWarehouse.id));

    const [updatedWarehouse] = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, existingWarehouse.id))
      .limit(1);

    if (!updatedWarehouse) throw new Error("No fue posible sincronizar la bodega del proyecto");
    return updatedWarehouse;
  }

  const [createdWarehouse] = await db
    .insert(warehouses)
    .values(warehousePayload)
    .returning();

  return createdWarehouse;
}

async function ensureWarehouses(seedInputs: WarehouseSeedInput[]) {
  const db = await getDb();
  if (!db || seedInputs.length === 0) return [] as Warehouse[];

  const uniqueInputs = Array.from(
    new Map(
      seedInputs
        .filter((input) => input.code.trim() && input.name.trim())
        .map((input) => {
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

  const codes = uniqueInputs.map((input) => input.code);
  const existingWarehouses = await db
    .select()
    .from(warehouses)
    .where(inArray(warehouses.code, codes));

  const existingCodes = new Set(existingWarehouses.map((warehouse) => warehouse.code));
  const warehousesToInsert = uniqueInputs.filter((input) => !existingCodes.has(input.code));

  if (warehousesToInsert.length > 0) {
    await db.insert(warehouses).values(warehousesToInsert).onConflictDoNothing();
  }

  return db
    .select()
    .from(warehouses)
    .where(inArray(warehouses.code, codes))
    .orderBy(asc(warehouses.code));
}

async function linkInventoryItemsToWarehousesByLocation(targetWarehouses?: Warehouse[]) {
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
    warehouseRows.map((warehouse) => [
      normalizeWarehouseLocationKey(warehouse.displayName),
      warehouse,
    ])
  );

  const updatesByWarehouse = new Map<number, { warehouse: Warehouse; ids: number[] }>();

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
    };
  }

  const parsedLocation = parseWarehouseLocation(warehouseLocation);
  if (!parsedLocation) {
    return {
      warehouseId: null,
      warehouseLocation: warehouseLocation?.trim() || null,
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
    };
  }

  return {
    warehouseId: warehouse.id,
    warehouseLocation: warehouse.displayName,
  };
}

export async function listWarehouses(filters?: { isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];

  const where =
    filters?.isActive === undefined
      ? undefined
      : eq(warehouses.isActive, filters.isActive);

  const rows = await db
    .select({
      warehouse: warehouses,
      project: projects,
      inventoryRows: count(inventoryItems.id),
      uniqueItems: sql<number>`count(distinct ${inventoryItems.sapItemCode})`,
    })
    .from(warehouses)
    .leftJoin(projects, eq(warehouses.projectId, projects.id))
    .leftJoin(inventoryItems, eq(inventoryItems.warehouseId, warehouses.id))
    .where(where)
    .groupBy(
      warehouses.id,
      warehouses.code,
      warehouses.name,
      warehouses.displayName,
      warehouses.projectId,
      warehouses.description,
      warehouses.isActive,
      warehouses.createdAt,
      warehouses.updatedAt,
      projects.id,
      projects.code,
      projects.name,
      projects.status
    )
    .orderBy(asc(warehouses.code));

  return rows.map(({ warehouse, project, inventoryRows, uniqueItems }) => ({
    ...warehouse,
    warehouseType: warehouse.projectId ? "proyecto" : "central",
    project: project
      ? {
          id: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
        }
      : null,
    inventoryRows: Number(inventoryRows ?? 0),
    uniqueItems: Number(uniqueItems ?? 0),
  }));
}

export async function createWarehouse(data: {
  projectId: number;
  description?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existingWarehouse = await getProjectWarehouseByProjectId(data.projectId);
  if (existingWarehouse) {
    throw new Error("Ese proyecto ya tiene un almacén asignado");
  }

  const warehouse = await ensureProjectWarehouse(data.projectId);
  const syncResult = await syncInventoryItemsToProjectWarehouse(
    data.projectId,
    warehouse
  );

  return {
    warehouse,
    linkedRows: syncResult.linkedRows,
  };
}

export async function syncProjectWarehouses() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(asc(projects.code));

  const syncedWarehouses: Warehouse[] = [];
  let linkedRows = 0;

  for (const project of allProjects) {
    const warehouse = await ensureProjectWarehouse(project.id);
    syncedWarehouses.push(warehouse);
    const syncResult = await syncInventoryItemsToProjectWarehouse(project.id, warehouse);
    linkedRows += syncResult.linkedRows;
  }

  return {
    warehouses: syncedWarehouses,
    linkedRows,
  };
}

export async function seedDefaultWarehouses() {
  return syncProjectWarehouses();
}

// ============================================================
// INVENTORY ITEMS
// ============================================================
export type InventorySortField =
  | "sapItemCode"
  | "name"
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
  projectId?: number;
  page?: number;
  pageSize?: number;
  sortBy?: InventorySortField;
  sortDir?: "asc" | "desc";
};

function buildInventoryWhere(filters?: InventoryListFilters) {
  const conditions = [];
  if (filters?.category) conditions.push(eq(inventoryItems.category, filters.category));
  if (filters?.isActive !== undefined) conditions.push(eq(inventoryItems.isActive, filters.isActive));
  if (filters?.warehouseId) conditions.push(eq(inventoryItems.warehouseId, filters.warehouseId));
  if (filters?.projectId) conditions.push(eq(inventoryItems.projectId, filters.projectId));
  if (filters?.search) {
    conditions.push(
      or(
        ilike(inventoryItems.name, `%${filters.search}%`),
        ilike(inventoryItems.sapItemCode, `%${filters.search}%`),
        ilike(inventoryItems.category, `%${filters.search}%`),
        ilike(inventoryItems.warehouseLocation, `%${filters.search}%`),
        ilike(warehouses.displayName, `%${filters.search}%`),
        ilike(projects.code, `%${filters.search}%`),
        ilike(projects.name, `%${filters.search}%`)
      )!
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function getInventoryIdsByFilters(filters?: InventoryListFilters) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(buildInventoryWhere(filters));

  return rows.map((row) => row.id);
}

export async function listInventoryItems(filters?: InventoryListFilters) {
  const db = await getDb();
  const requestedPage = Math.max(filters?.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters?.pageSize ?? 25, 10), 200);
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
      case "unit":
        return inventoryItems.unit;
      case "currentStock":
        return inventoryItems.currentStock;
      case "minimumStock":
        return inventoryItems.minimumStock;
      case "warehouseLocation":
        return sql<string>`coalesce(${warehouses.displayName}, ${inventoryItems.warehouseLocation})`;
      case "projectName":
        return sql<string>`coalesce(${projects.name}, 'Inventario Central')`;
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
      warehouse: warehouses,
      project: projects,
    })
    .from(inventoryItems)
    .leftJoin(warehouses, eq(inventoryItems.warehouseId, warehouses.id))
    .leftJoin(projects, eq(inventoryItems.projectId, projects.id))
    .where(where)
    .orderBy(primaryOrder, secondaryOrder)
    .limit(pageSize)
    .offset(offset);

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

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    sortBy,
    sortDir,
  };
}

async function resolveProjectAssignment(projectId?: number | null) {
  if (!projectId) return null;

  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error("El proyecto seleccionado no existe");
  }

  const warehouse = await ensureProjectWarehouse(project.id);

  return {
    projectId: project.id,
    warehouseId: warehouse.id,
    warehouseLocation: warehouse.displayName,
  };
}

export async function createInventoryItem(data: InsertInventoryItem) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const projectAssignment = await resolveProjectAssignment(data.projectId);
  const warehouseAssignment = projectAssignment
    ? {
        warehouseId: projectAssignment.warehouseId,
        warehouseLocation: projectAssignment.warehouseLocation,
      }
    : await resolveWarehouseAssignment(data.warehouseId, data.warehouseLocation);
  const [inventoryItem] = await db
    .insert(inventoryItems)
    .values({
      ...data,
      projectId: projectAssignment?.projectId ?? null,
      warehouseId: warehouseAssignment.warehouseId,
      warehouseLocation: warehouseAssignment.warehouseLocation,
    })
    .returning({ id: inventoryItems.id });
  return { id: inventoryItem.id };
}

export async function updateInventoryItem(id: number, data: Partial<InsertInventoryItem>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const projectAssignment =
    data.projectId === undefined
      ? undefined
      : await resolveProjectAssignment(data.projectId);

  const nextData: Partial<InsertInventoryItem> = { ...data };
  if (data.projectId !== undefined) {
    nextData.projectId = projectAssignment?.projectId ?? null;
    if (projectAssignment) {
      nextData.warehouseId = projectAssignment.warehouseId;
      nextData.warehouseLocation = projectAssignment.warehouseLocation;
    } else if (data.warehouseId === undefined && data.warehouseLocation === undefined) {
      nextData.warehouseId = null;
      nextData.warehouseLocation = null;
    }
  }
  if (data.projectId === undefined && (data.warehouseId !== undefined || data.warehouseLocation !== undefined)) {
    const warehouseAssignment = await resolveWarehouseAssignment(
      data.warehouseId,
      data.warehouseLocation
    );
    nextData.warehouseId = warehouseAssignment.warehouseId;
    nextData.warehouseLocation = warehouseAssignment.warehouseLocation;
  }

  await db.update(inventoryItems).set(nextData).where(eq(inventoryItems.id, id));
  return { success: true };
}

export async function bulkAssignInventoryProject(
  ids: number[],
  projectId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (ids.length === 0) {
    throw new Error("Debe seleccionar al menos un ítem");
  }

  const projectAssignment = await resolveProjectAssignment(projectId);

  const result = await db
    .update(inventoryItems)
    .set({
      projectId: projectAssignment?.projectId ?? null,
      warehouseId: projectAssignment?.warehouseId ?? null,
      warehouseLocation: projectAssignment?.warehouseLocation ?? null,
      updatedAt: new Date(),
    })
    .where(inArray(inventoryItems.id, ids))
    .returning({ id: inventoryItems.id });

  return {
    success: true,
    updatedCount: result.length,
  };
}

export async function bulkAssignInventoryProjectByFilters(
  filters: InventoryListFilters,
  projectId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const ids = await getInventoryIdsByFilters(filters);
  if (ids.length === 0) {
    return {
      success: true,
      updatedCount: 0,
    };
  }

  const projectAssignment = await resolveProjectAssignment(projectId);
  let updatedCount = 0;

  for (const idChunk of chunkItems(ids, DEMO_IMPORT_BATCH_SIZE)) {
    const result = await db
      .update(inventoryItems)
      .set({
        projectId: projectAssignment?.projectId ?? null,
        warehouseId: projectAssignment?.warehouseId ?? null,
        warehouseLocation: projectAssignment?.warehouseLocation ?? null,
        updatedAt: new Date(),
      })
      .where(inArray(inventoryItems.id, idChunk))
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

  const inventoryMatch = await db
    .select({
      sapItemCode: inventoryItems.sapItemCode,
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.sapItemCode, normalizedSapItemCode))
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(1);

  if (inventoryMatch[0]) {
    return {
      sapItemCode: inventoryMatch[0].sapItemCode,
      itemName: inventoryMatch[0].itemName,
      unit: inventoryMatch[0].unit,
      source: "inventory" as const,
    };
  }

  const catalogMatch = await db
    .select({
      itemCode: sapCatalog.itemCode,
      description: sapCatalog.description,
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
      source: "catalog" as const,
    };
  }

  const fuzzyMatches = await searchSapCatalog(normalizedSapItemCode);
  if (fuzzyMatches.length === 1) {
    return {
      sapItemCode: fuzzyMatches[0].itemCode,
      itemName: fuzzyMatches[0].description,
      unit: null,
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
    .where(and(eq(sapSyncLog.entityType, entityType), eq(sapSyncLog.entityId, entityId)))
    .orderBy(desc(sapSyncLog.createdAt));
}

// ============================================================
// DASHBOARD QUERIES
// ============================================================
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;

  const [requestsByStatus] = await Promise.all([
    db
      .select({
        status: materialRequests.status,
        count: count(),
      })
      .from(materialRequests)
      .groupBy(materialRequests.status),
  ]);

  const [totalRequests] = await db.select({ count: count() }).from(materialRequests);
  const [totalProjects] = await db
    .select({ count: count() })
    .from(projects)
    .where(eq(projects.status, "activo"));
  const [totalReturns] = await db.select({ count: count() }).from(reverseLogistics);
  const [pendingReturns] = await db
    .select({ count: count() })
    .from(reverseLogistics)
    .where(eq(reverseLogistics.status, "pendiente"));

  const requestsByProject = await db
    .select({
      projectId: materialRequests.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      count: count(),
    })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .groupBy(materialRequests.projectId, projects.code, projects.name);

  const requestsByFlow = await db
    .select({
      flowType: supplyFlowRecords.flowType,
      count: count(),
    })
    .from(supplyFlowRecords)
    .groupBy(supplyFlowRecords.flowType);

  const recentRequests = await db
    .select({
      request: materialRequests,
      project: projects,
    })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
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
export async function getUsersByBuildreqRole(
  role: BuildReqRole
) {
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
  return db
    .select()
    .from(users)
    .where(
      and(
        eq(users.buildreqRole, role),
        eq(users.assignedProjectId, projectId)
      )
    );
}


// ============================================================
// INVITATIONS
// ============================================================
export async function createInvitation(data: InsertInvitation) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [invitation] = await db
    .insert(invitations)
    .values(data)
    .returning({ id: invitations.id });
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
  return result[0];
}

export async function getInvitationByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.status, "pendiente")
      )
    )
    .limit(1);
  return result[0];
}

export async function listInvitations() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      invitation: invitations,
      project: projects,
    })
    .from(invitations)
    .leftJoin(projects, eq(invitations.assignedProjectId, projects.id))
    .orderBy(desc(invitations.createdAt));
}

export async function acceptInvitation(
  invitationId: number,
  userId: number
) {
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
  }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(users)
    .set({
      buildreqRole: invitation.buildreqRole,
      assignedProjectId: invitation.assignedProjectId,
    })
    .where(eq(users.id, userId));
  return { success: true };
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return result[0];
}


// ============================================================
// SAP CATALOG
// ============================================================
export async function searchSapCatalog(search: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(sapCatalog)
    .where(
      and(
        eq(sapCatalog.isActive, true),
        or(
          ilike(sapCatalog.itemCode, `%${search}%`),
          ilike(sapCatalog.description, `%${search}%`)
        )
      )
    )
    .orderBy(sapCatalog.itemCode)
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
  const result = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
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
  return db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.isActive, true),
        or(
          ilike(suppliers.supplierCode, `%${search}%`),
          ilike(suppliers.name, `%${search}%`)
        )
      )
    )
    .orderBy(suppliers.name)
    .limit(20);
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
      totalRows <= 0 ? 100 : Math.min(100, Math.round((boundedProcessed / totalRows) * 100));

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
    new Map(payload.articles.map((article) => [article.itemCode, article])).values()
  );
  const articleSummary = createDemoImportCounters(catalogArticles.length);
  const importedWarehouses = await ensureWarehouses(
    payload.articles
      .map((article) => {
        const code = article.warehouseCode?.trim();
        const name = article.warehouseName?.trim();
        if (code && name) {
          return { code, name } satisfies WarehouseSeedInput;
        }

        const parsedLocation = parseWarehouseLocation(article.warehouseLocation);
        if (!parsedLocation) return null;

        return {
          code: parsedLocation.code,
          name: parsedLocation.name,
        } satisfies WarehouseSeedInput;
      })
      .filter((warehouse): warehouse is WarehouseSeedInput => Boolean(warehouse))
  );
  const importedWarehouseMap = new Map(
    importedWarehouses.map((warehouse) => [
      normalizeWarehouseLocationKey(warehouse.displayName),
      warehouse,
    ])
  );
  const workload = getDemoImportWorkload(payload);
  const reportProgress = createProgressReporter(workload.totalRows, options?.onProgress);

  let projectStageProcessed = 0;
  await reportProgress({
    stage: "projects",
    stageLabel: "Procesando proyectos",
    currentStageProcessed: 0,
    currentStageTotal: payload.projects.length,
  });

  for (const projectChunk of chunkItems(payload.projects, DEMO_IMPORT_BATCH_SIZE)) {
    if (projectChunk.length === 0) continue;

    const projectCodes = projectChunk.map((project) => project.code);
    const existingProjects = await db
      .select()
      .from(projects)
      .where(inArray(projects.code, projectCodes));

    const existingProjectMap = new Map(
      existingProjects.map((project) => [project.code, project])
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

  for (const articleChunk of chunkItems(catalogArticles, DEMO_IMPORT_BATCH_SIZE)) {
    if (articleChunk.length === 0) continue;

    const articleCodes = articleChunk.map((article) => article.itemCode);
    const existingCatalog = await db
      .select()
      .from(sapCatalog)
      .where(inArray(sapCatalog.itemCode, articleCodes));

    const existingCatalogMap = new Map(
      existingCatalog.map((article) => [article.itemCode, article])
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

  for (const inventoryChunk of chunkItems(payload.articles, DEMO_IMPORT_BATCH_SIZE)) {
    if (inventoryChunk.length === 0) continue;

    const articleCodes = Array.from(
      new Set(inventoryChunk.map((article) => article.itemCode))
    );
    const existingInventory = await db
      .select()
      .from(inventoryItems)
      .where(inArray(inventoryItems.sapItemCode, articleCodes));

    const existingInventoryMap = new Map(
      existingInventory.map((item) => [
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

  for (const supplierChunk of chunkItems(payload.suppliers, DEMO_IMPORT_BATCH_SIZE)) {
    if (supplierChunk.length === 0) continue;

    const supplierCodes = supplierChunk.map((supplier) => supplier.supplierCode);
    const existingSuppliers = await db
      .select()
      .from(suppliers)
      .where(inArray(suppliers.supplierCode, supplierCodes));

    const existingSuppliersMap = new Map(
      existingSuppliers.map((supplier) => [supplier.supplierCode, supplier])
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

  return db.transaction(async (tx) => {
    const demoProjects = await tx
      .select()
      .from(projects)
      .where(isNotNull(projects.demoBatchKey));

    const projectIds = demoProjects.map((project) => project.id);

    if (projectIds.length > 0) {
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
