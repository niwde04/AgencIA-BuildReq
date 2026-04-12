import { eq, and, desc, sql, count, ilike, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser,
  users,
  projects,
  materialRequests,
  requestItems,
  supplyFlowRecords,
  reverseLogistics,
  reverseLogisticsItems,
  attachments,
  notifications,
  inventoryItems,
  sapSyncLog,
  invitations,
  sapCatalog,
  suppliers,
} from "../drizzle/schema";
import type {
  InsertProject,
  InsertMaterialRequest,
  InsertRequestItem,
  InsertSupplyFlowRecord,
  InsertReverseLogistic,
  InsertReverseLogisticItem,
  InsertAttachment,
  InsertNotification,
  InsertInventoryItem,
  InsertSapSyncLogEntry,
  InsertInvitation,
  InsertSapCatalogItem,
  InsertSupplier,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

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

export async function updateUserRole(
  userId: number,
  buildreqRole: "ingeniero_residente" | "jefe_bodega_central" | "administracion_central",
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
export async function listProjects(statusFilter?: string) {
  const db = await getDb();
  if (!db) return [];
  if (statusFilter) {
    return db
      .select()
      .from(projects)
      .where(eq(projects.status, statusFilter as any))
      .orderBy(desc(projects.createdAt));
  }
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export async function getProjectByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return result[0];
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(projects).values(data);
  return { id: result.insertId };
}

export async function updateProject(id: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(projects).set(data).where(eq(projects.id, id));
  return { success: true };
}

export async function countActiveProjects() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: count() })
    .from(projects)
    .where(eq(projects.status, "activo"));
  return result[0]?.count ?? 0;
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

  const requestNumber = await generateRequestNumber();
  const [result] = await db.insert(materialRequests).values({
    ...data,
    requestNumber,
  });
  const requestId = result.insertId;

  if (items.length > 0) {
    await db.insert(requestItems).values(
      items.map((item) => ({ ...item, requestId }))
    );
  }

  return { id: requestId, requestNumber };
}

export async function listMaterialRequests(filters?: {
  projectId?: number;
  status?: string;
  requestedById?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.projectId) conditions.push(eq(materialRequests.projectId, filters.projectId));
  if (filters?.status) conditions.push(eq(materialRequests.status, filters.status as any));
  if (filters?.requestedById) conditions.push(eq(materialRequests.requestedById, filters.requestedById));

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

  return { ...rows[0], items };
}

export async function updateMaterialRequestStatus(
  id: number,
  status: "en_espera" | "en_proceso" | "cerrada",
  processedById?: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const updateData: Record<string, unknown> = { status };
  if (processedById) updateData.processedById = processedById;
  if (status === "en_proceso") updateData.processedAt = new Date();
  if (status === "cerrada") updateData.closedAt = new Date();

  await db.update(materialRequests).set(updateData).where(eq(materialRequests.id, id));
  return { success: true };
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

export async function getRequestItemsByRequestId(requestId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(requestItems).where(eq(requestItems.requestId, requestId));
}

// ============================================================
// SUPPLY FLOW RECORDS
// ============================================================
export async function createSupplyFlowRecord(data: InsertSupplyFlowRecord) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(supplyFlowRecords).values(data);
  return { id: result.insertId };
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

// ============================================================
// AUTO-NUMBERING: Purchase Orders
// ============================================================
export async function generatePurchaseOrderNumber() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const year = new Date().getFullYear();
  const result = await db
    .select({ count: count() })
    .from(supplyFlowRecords)
    .where(
      and(
        sql`EXTRACT(YEAR FROM ${supplyFlowRecords.createdAt}) = ${year}`,
        sql`${supplyFlowRecords.purchaseOrderNumber} IS NOT NULL`
      )
    );
  const num = (result[0]?.count ?? 0) + 1;
  return `OC-${year}-${String(num).padStart(4, "0")}`;
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
  const [result] = await db.insert(reverseLogistics).values({
    ...data,
    returnNumber,
  });
  const reverseLogisticId = result.insertId;

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
  const [result] = await db.insert(attachments).values(data);
  return { id: result.insertId };
}

export async function getAttachmentsByEntity(
  entityType: "material_request" | "supply_flow" | "reverse_logistic",
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
  const [result] = await db.insert(notifications).values(data);
  return { id: result.insertId };
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
// INVENTORY ITEMS
// ============================================================
export async function listInventoryItems(filters?: {
  category?: string;
  search?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.category) conditions.push(eq(inventoryItems.category, filters.category));
  if (filters?.isActive !== undefined) conditions.push(eq(inventoryItems.isActive, filters.isActive));
  if (filters?.search) {
    conditions.push(
      or(
        ilike(inventoryItems.name, `%${filters.search}%`),
        ilike(inventoryItems.sapItemCode, `%${filters.search}%`)
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(inventoryItems)
    .where(where)
    .orderBy(inventoryItems.name);
}

export async function createInventoryItem(data: InsertInventoryItem) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(inventoryItems).values(data);
  return { id: result.insertId };
}

export async function updateInventoryItem(id: number, data: Partial<InsertInventoryItem>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(inventoryItems).set(data).where(eq(inventoryItems.id, id));
  return { success: true };
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

// ============================================================
// SAP SYNC LOG
// ============================================================
export async function createSapSyncLog(data: InsertSapSyncLogEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(sapSyncLog).values(data);
  return { id: result.insertId };
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
  role: "ingeniero_residente" | "jefe_bodega_central" | "administracion_central"
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.buildreqRole, role));
}


// ============================================================
// INVITATIONS
// ============================================================
export async function createInvitation(data: InsertInvitation) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(invitations).values(data);
  return { id: result.insertId };
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
    buildreqRole: "ingeniero_residente" | "jefe_bodega_central" | "administracion_central";
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
