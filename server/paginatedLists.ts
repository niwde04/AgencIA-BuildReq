import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  invoices,
  invoiceItems,
  materialRequests,
  procurementApprovalHistory,
  projectSubprojects,
  projects,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  receiptItems,
  receipts,
  requestItems,
  suppliers,
  supplyFlowRecords,
  transferRequestItems,
  transferRequests,
  transfers,
  users,
} from "../drizzle/schema";
import * as data from "./db";

export type PageInput = {
  page?: number;
  pageSize?: number;
  search?: string;
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function normalizePage(input?: PageInput) {
  return {
    requestedPage: Math.max(input?.page ?? 1, 1),
    pageSize: Math.min(Math.max(input?.pageSize ?? 50, 10), 200),
  };
}

export function getPageMeta(total: number, input?: PageInput) {
  const { requestedPage, pageSize } = normalizePage(input);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  return {
    page,
    pageSize,
    totalPages,
    offset: (page - 1) * pageSize,
  };
}

export function pageResult<T>(items: T[], total: number, input?: PageInput) {
  const { page, pageSize, totalPages } = getPageMeta(total, input);
  return { items, total, page, pageSize, totalPages };
}

function addProjectScope(
  conditions: any[],
  column: any,
  projectIds?: number[]
) {
  if (projectIds === undefined) return;
  conditions.push(
    projectIds.length > 0 ? inArray(column, projectIds) : sql`false`
  );
}

function uniqueIds(rows: Array<{ id: number | null }>) {
  return Array.from(
    new Set(
      rows
        .map(row => row.id)
        .filter((id): id is number => typeof id === "number")
    )
  );
}

export type MaterialRequestPageFilters = PageInput & {
  projectId?: number;
  projectIds?: number[];
  status?: string;
  requestedById?: number;
  requestType?: string;
  workflowStage?: string;
};

export async function listMaterialRequestsPage(
  filters: MaterialRequestPageFilters
) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const conditions: any[] = [];
  if (filters.projectId)
    conditions.push(eq(materialRequests.projectId, filters.projectId));
  addProjectScope(conditions, materialRequests.projectId, filters.projectIds);
  if (filters.status)
    conditions.push(sql`${materialRequests.status}::text = ${filters.status}`);
  if (filters.requestedById)
    conditions.push(eq(materialRequests.requestedById, filters.requestedById));
  if (filters.requestType)
    conditions.push(
      sql`${materialRequests.requestType}::text = ${filters.requestType}`
    );
  if (filters.workflowStage)
    conditions.push(
      sql`${materialRequests.workflowStage}::text = ${filters.workflowStage}`
    );

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const normalizedSearch = search.toLowerCase();
    const targetRows = await database
      .select({ id: requestItems.requestId })
      .from(requestItems)
      .leftJoin(
        projectSubprojects,
        eq(requestItems.subProjectId, projectSubprojects.id)
      )
      .where(
        or(
          ilike(requestItems.itemName, pattern),
          ilike(projectSubprojects.code, pattern),
          ilike(projectSubprojects.name, pattern),
          sql`concat_ws(' ', ${projectSubprojects.code}, ${projectSubprojects.name}) ilike ${pattern}`,
          "subproyecto".includes(normalizedSearch)
            ? eq(requestItems.targetType, "subproyecto" as any)
            : sql`false`,
          "activo fijo".includes(normalizedSearch)
            ? eq(requestItems.targetType, "activo_fijo" as any)
            : sql`false`,
          ilike(requestItems.fixedAssetSapItemCode, pattern),
          ilike(requestItems.fixedAssetName, pattern)
        )
      );
    const targetIds = uniqueIds(targetRows);
    conditions.push(
      or(
        ilike(materialRequests.requestNumber, pattern),
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        ilike(users.name, pattern),
        ilike(users.email, pattern),
        targetIds.length > 0
          ? inArray(materialRequests.id, targetIds)
          : sql`false`
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const baseCount = database
    .select({ count: count() })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .leftJoin(users, eq(materialRequests.requestedById, users.id));
  const [totalRow] = await baseCount.where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await database
    .select({ id: materialRequests.id })
    .from(materialRequests)
    .leftJoin(projects, eq(materialRequests.projectId, projects.id))
    .leftJoin(users, eq(materialRequests.requestedById, users.id))
    .where(where)
    .orderBy(desc(materialRequests.createdAt), desc(materialRequests.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const ids = uniqueIds(idRows);
  const items = await data.listMaterialRequests({
    ids,
    projectId: filters.projectId,
    projectIds: filters.projectIds,
    status: filters.status,
    requestedById: filters.requestedById,
    requestType: filters.requestType,
    workflowStage: filters.workflowStage,
  });
  return pageResult(items, total, filters);
}

export type SupplyFlowPageFilters = PageInput & {
  flowType?: string;
  flowTypes?: string[];
  status?: string;
  requestedById?: number;
  projectId?: number;
  projectIds?: number[];
};

export async function listSupplyFlowsPage(filters: SupplyFlowPageFilters) {
  const database = await data.getDb();
  if (!database)
    return {
      ...pageResult([], 0, filters),
      countsByFlow: {} as Record<string, number>,
    };
  const conditions: any[] = [];
  if (filters.flowType)
    conditions.push(
      sql`${supplyFlowRecords.flowType}::text = ${filters.flowType}`
    );
  if (filters.flowTypes)
    conditions.push(
      filters.flowTypes.length > 0
        ? sql`${supplyFlowRecords.flowType}::text in (${sql.join(
            filters.flowTypes.map(value => sql`${value}`),
            sql`, `
          )})`
        : sql`false`
    );
  if (filters.status)
    conditions.push(sql`${supplyFlowRecords.status}::text = ${filters.status}`);
  if (filters.requestedById)
    conditions.push(eq(materialRequests.requestedById, filters.requestedById));
  if (filters.projectId)
    conditions.push(eq(materialRequests.projectId, filters.projectId));
  addProjectScope(conditions, materialRequests.projectId, filters.projectIds);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [totalRow] = await database
    .select({ count: count() })
    .from(supplyFlowRecords)
    .leftJoin(
      materialRequests,
      eq(supplyFlowRecords.requestId, materialRequests.id)
    )
    .where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await database
    .select({ id: supplyFlowRecords.id })
    .from(supplyFlowRecords)
    .leftJoin(
      materialRequests,
      eq(supplyFlowRecords.requestId, materialRequests.id)
    )
    .where(where)
    .orderBy(desc(supplyFlowRecords.createdAt), desc(supplyFlowRecords.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const countRows = await database
    .select({
      flowType: supplyFlowRecords.flowType,
      count: count(),
    })
    .from(supplyFlowRecords)
    .leftJoin(
      materialRequests,
      eq(supplyFlowRecords.requestId, materialRequests.id)
    )
    .where(where)
    .groupBy(supplyFlowRecords.flowType);
  const countsByFlow = Object.fromEntries(
    countRows.map(row => [row.flowType, row.count])
  );
  const items = await data.listSupplyFlowRecords({
    ids: uniqueIds(idRows),
    flowType: filters.flowType,
    status: filters.status,
    requestedById: filters.requestedById,
    projectId: filters.projectId,
    projectIds: filters.projectIds,
  });
  return { ...pageResult(items, total, filters), countsByFlow };
}

export type PurchaseRequestPageFilters = PageInput & {
  projectId?: number;
  projectIds?: number[];
  purchaseType?: string;
  status?: string;
  approvalsEnabled?: boolean;
  pendingApprovalOnly?: boolean;
};

export async function listPurchaseRequestsPage(
  filters: PurchaseRequestPageFilters
) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const createdBy = alias(users, "pr_page_created_by");
  const requestedBy = alias(users, "pr_page_requested_by");
  const conditions: any[] = [];
  if (filters.projectId)
    conditions.push(eq(purchaseRequests.projectId, filters.projectId));
  addProjectScope(conditions, purchaseRequests.projectId, filters.projectIds);
  if (filters.purchaseType)
    conditions.push(
      sql`${purchaseRequests.purchaseType}::text = ${filters.purchaseType}`
    );
  if (filters.pendingApprovalOnly) {
    conditions.push(
      and(
        eq(purchaseRequests.status, "en_revision" as any),
        eq(purchaseRequests.approvalStatus, "pendiente" as any)
      )!
    );
  } else if (filters.status) {
    if (!filters.approvalsEnabled && filters.status === "pendiente") {
      conditions.push(
        or(
          eq(purchaseRequests.status, "pendiente" as any),
          and(
            sql`${purchaseRequests.approvalStatus} is not null`,
            sql`${purchaseRequests.status}::text in ('en_revision', 'rechazada')`
          )
        )!
      );
    } else {
      conditions.push(
        sql`${purchaseRequests.status}::text = ${filters.status}`
      );
    }
  }

  if (filters.projectIds !== undefined && filters.projectIds.length > 0) {
    const outsideRows = await database
      .select({ id: purchaseRequestItems.purchaseRequestId })
      .from(purchaseRequestItems)
      .leftJoin(
        requestItems,
        eq(purchaseRequestItems.materialRequestItemId, requestItems.id)
      )
      .leftJoin(
        materialRequests,
        eq(requestItems.requestId, materialRequests.id)
      )
      .where(notInArray(materialRequests.projectId, filters.projectIds));
    const outsideIds = uniqueIds(outsideRows);
    if (outsideIds.length > 0)
      conditions.push(notInArray(purchaseRequests.id, outsideIds));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const sourceProject = alias(projects, "pr_page_source_project");
    const sourceRows = await database
      .select({ id: purchaseRequestItems.purchaseRequestId })
      .from(purchaseRequestItems)
      .leftJoin(
        requestItems,
        eq(purchaseRequestItems.materialRequestItemId, requestItems.id)
      )
      .leftJoin(
        materialRequests,
        eq(requestItems.requestId, materialRequests.id)
      )
      .leftJoin(sourceProject, eq(materialRequests.projectId, sourceProject.id))
      .leftJoin(requestedBy, eq(materialRequests.requestedById, requestedBy.id))
      .where(
        or(
          ilike(materialRequests.requestNumber, pattern),
          ilike(sourceProject.code, pattern),
          ilike(sourceProject.name, pattern),
          sql`concat_ws(' ', ${sourceProject.code}, ${sourceProject.name}) ilike ${pattern}`,
          ilike(requestedBy.name, pattern),
          ilike(requestedBy.email, pattern)
        )
      );
    const approvalRows = await database
      .select({ id: procurementApprovalHistory.documentId })
      .from(procurementApprovalHistory)
      .where(
        and(
          eq(procurementApprovalHistory.documentType, "purchase_request"),
          ilike(procurementApprovalHistory.actorName, pattern)
        )
      );
    const relatedIds = uniqueIds([...sourceRows, ...approvalRows]);
    conditions.push(
      or(
        ilike(purchaseRequests.requestNumber, pattern),
        ilike(materialRequests.requestNumber, pattern),
        ilike(purchaseRequests.sapDocumentNumber, pattern),
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        ilike(createdBy.name, pattern),
        relatedIds.length > 0
          ? inArray(purchaseRequests.id, relatedIds)
          : sql`false`
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const base = () =>
    database
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
      .leftJoin(
        materialRequests,
        eq(purchaseRequests.materialRequestId, materialRequests.id)
      )
      .leftJoin(createdBy, eq(purchaseRequests.createdById, createdBy.id));
  const [totalRow] = await database
    .select({ count: count() })
    .from(purchaseRequests)
    .leftJoin(projects, eq(purchaseRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(purchaseRequests.materialRequestId, materialRequests.id)
    )
    .leftJoin(createdBy, eq(purchaseRequests.createdById, createdBy.id))
    .where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await base()
    .where(where)
    .orderBy(desc(purchaseRequests.createdAt), desc(purchaseRequests.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const items = await data.listPurchaseRequests({
    ids: uniqueIds(idRows),
    projectId: filters.projectId,
    projectIds: filters.projectIds,
  });
  return pageResult(items, total, filters);
}

export type PurchaseOrderPageFilters = PageInput & {
  projectId?: number;
  projectIds?: number[];
  classification?: string;
  purchaseType?: string;
  status?: string;
  approvalsEnabled?: boolean;
  pendingApprovalOnly?: boolean;
};

export async function listPurchaseOrdersPage(
  filters: PurchaseOrderPageFilters
) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const createdBy = alias(users, "po_page_created_by");
  const requestedBy = alias(users, "po_page_requested_by");
  const conditions: any[] = [];
  if (filters.projectId)
    conditions.push(eq(purchaseOrders.projectId, filters.projectId));
  addProjectScope(conditions, purchaseOrders.projectId, filters.projectIds);
  if (filters.classification)
    conditions.push(
      sql`${purchaseOrders.classification}::text = ${filters.classification}`
    );
  if (filters.purchaseType)
    conditions.push(
      sql`${purchaseOrders.purchaseType}::text = ${filters.purchaseType}`
    );
  if (filters.pendingApprovalOnly) {
    conditions.push(
      and(
        eq(purchaseOrders.status, "pendiente_aprobacion" as any),
        eq(purchaseOrders.approvalStatus, "pendiente" as any)
      )!
    );
  } else if (filters.status) {
    if (!filters.approvalsEnabled && filters.status === "borrador") {
      conditions.push(
        or(
          eq(purchaseOrders.status, "borrador" as any),
          and(
            sql`${purchaseOrders.approvalStatus} is not null`,
            sql`${purchaseOrders.status}::text in ('pendiente_aprobacion', 'rechazada')`
          )
        )!
      );
    } else {
      conditions.push(sql`${purchaseOrders.status}::text = ${filters.status}`);
    }
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const sourceRows = await database
      .select({ id: purchaseOrderItems.purchaseOrderId })
      .from(purchaseOrderItems)
      .leftJoin(
        requestItems,
        eq(purchaseOrderItems.materialRequestItemId, requestItems.id)
      )
      .leftJoin(
        materialRequests,
        eq(requestItems.requestId, materialRequests.id)
      )
      .leftJoin(requestedBy, eq(materialRequests.requestedById, requestedBy.id))
      .where(
        or(
          ilike(materialRequests.requestNumber, pattern),
          ilike(requestedBy.name, pattern),
          ilike(requestedBy.email, pattern)
        )
      );
    const sourceIds = uniqueIds(sourceRows);
    const normalizedSearch = search.toLowerCase();
    const directPurchaseMatch = "compra directa".includes(normalizedSearch);
    const localMatch = "compra local".includes(normalizedSearch);
    const foreignMatch = "compra extranjera".includes(normalizedSearch);
    conditions.push(
      or(
        ilike(purchaseOrders.orderNumber, pattern),
        sql`${purchaseOrders.classification}::text ilike ${pattern}`,
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        ilike(suppliers.name, pattern),
        ilike(suppliers.supplierCode, pattern),
        ilike(suppliers.rtn, pattern),
        ilike(createdBy.name, pattern),
        directPurchaseMatch
          ? eq(purchaseOrders.purchaseType, "compra_directa" as any)
          : sql`false`,
        localMatch
          ? eq(purchaseOrders.purchaseType, "local" as any)
          : sql`false`,
        foreignMatch
          ? eq(purchaseOrders.purchaseType, "extranjera" as any)
          : sql`false`,
        sourceIds.length > 0
          ? inArray(purchaseOrders.id, sourceIds)
          : sql`false`
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const baseOrderQuery = () =>
    database
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(createdBy, eq(purchaseOrders.createdById, createdBy.id));
  const [totalRow] = await database
    .select({ count: count() })
    .from(purchaseOrders)
    .leftJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(createdBy, eq(purchaseOrders.createdById, createdBy.id))
    .where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await baseOrderQuery()
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const items = await data.listPurchaseOrders({
    ids: uniqueIds(idRows),
    projectId: filters.projectId,
    projectIds: filters.projectIds,
    classification: filters.classification,
  });
  return pageResult(items, total, filters);
}

export type TransferRequestPageFilters = PageInput & {
  projectId?: number;
  projectIds?: number[];
  status?: string;
};

export async function listTransferRequestsPage(
  filters: TransferRequestPageFilters
) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const conditions: any[] = [];
  if (filters.projectId)
    conditions.push(eq(transferRequests.projectId, filters.projectId));
  if (filters.projectIds !== undefined) {
    conditions.push(
      filters.projectIds.length > 0
        ? or(
            inArray(transferRequests.projectId, filters.projectIds),
            inArray(transferRequests.destinationProjectId, filters.projectIds)
          )!
        : sql`false`
    );
  }
  if (filters.status)
    conditions.push(sql`${transferRequests.status}::text = ${filters.status}`);
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const normalizedSearch = search.toLowerCase();
    conditions.push(
      or(
        ilike(transferRequests.requestNumber, pattern),
        ilike(materialRequests.requestNumber, pattern),
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        sql`('Proyecto ' || ${transferRequests.destinationProjectId}::text) ilike ${pattern}`,
        "proyecto/bodega destino en recepción".includes(normalizedSearch) ||
          "bodega central".includes(normalizedSearch)
          ? eq(transferRequests.destinationType, "bodega_central" as any)
          : sql`false`
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [totalRow] = await database
    .select({ count: count() })
    .from(transferRequests)
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(transferRequests.materialRequestId, materialRequests.id)
    )
    .where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await database
    .select({ id: transferRequests.id })
    .from(transferRequests)
    .leftJoin(projects, eq(transferRequests.projectId, projects.id))
    .leftJoin(
      materialRequests,
      eq(transferRequests.materialRequestId, materialRequests.id)
    )
    .where(where)
    .orderBy(desc(transferRequests.createdAt), desc(transferRequests.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const items = await data.listTransferRequests({
    ids: uniqueIds(idRows),
    projectId: filters.projectId,
    projectIds: filters.projectIds,
    status: filters.status,
  });
  return pageResult(items, total, filters);
}

export type TransferPageFilters = PageInput & {
  status?: string;
  receivableOnly?: boolean;
  sourceProjectId?: number;
  destinationProjectId?: number;
  projectIds?: number[];
};

export async function listTransfersPage(filters: TransferPageFilters) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const destinationProject = alias(
    projects,
    "transfer_page_destination_project"
  );
  const conditions: any[] = [];
  if (filters.status)
    conditions.push(sql`${transfers.status}::text = ${filters.status}`);
  if (filters.receivableOnly)
    conditions.push(
      sql`${transfers.status}::text in ('confirmado', 'en_transito', 'parcialmente_recibido')`
    );
  if (filters.sourceProjectId)
    conditions.push(
      or(
        eq(transferRequests.projectId, filters.sourceProjectId),
        inArray(
          transferRequests.id,
          database
            .select({ id: transferRequestItems.transferRequestId })
            .from(transferRequestItems)
            .where(
              eq(
                transferRequestItems.sourceProjectId,
                filters.sourceProjectId
              )
            )
        )
      )!
    );
  if (filters.destinationProjectId)
    conditions.push(
      eq(transferRequests.destinationProjectId, filters.destinationProjectId)
    );
  if (filters.projectIds !== undefined) {
    conditions.push(
      filters.projectIds.length > 0
        ? or(
            inArray(transferRequests.projectId, filters.projectIds),
            inArray(transferRequests.destinationProjectId, filters.projectIds),
            inArray(
              transferRequests.id,
              database
                .select({ id: transferRequestItems.transferRequestId })
                .from(transferRequestItems)
                .where(
                  inArray(
                    transferRequestItems.sourceProjectId,
                    filters.projectIds
                  )
                )
            )
          )!
        : sql`false`
    );
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(transfers.transferNumber, pattern),
        ilike(transferRequests.requestNumber, pattern),
        ilike(transfers.remissionGuideNumber, pattern),
        ilike(transfers.sapCorrelative, pattern),
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        ilike(destinationProject.code, pattern),
        ilike(destinationProject.name, pattern),
        sql`concat_ws(' ', ${destinationProject.code}, ${destinationProject.name}) ilike ${pattern}`
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const joins = (query: any) =>
    query
      .leftJoin(
        transferRequests,
        eq(transfers.transferRequestId, transferRequests.id)
      )
      .leftJoin(projects, eq(transferRequests.projectId, projects.id))
      .leftJoin(
        destinationProject,
        eq(transferRequests.destinationProjectId, destinationProject.id)
      );
  const [totalRow] = await joins(
    database.select({ count: count() }).from(transfers)
  ).where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await joins(
    database.select({ id: transfers.id }).from(transfers)
  )
    .where(where)
    .orderBy(desc(transfers.createdAt), desc(transfers.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const items = await data.listTransfers({
    ids: uniqueIds(idRows),
    status: filters.status,
    receivableOnly: filters.receivableOnly,
    sourceProjectId: filters.sourceProjectId,
    destinationProjectId: filters.destinationProjectId,
    projectIds: filters.projectIds,
  });
  return pageResult(items, total, filters);
}

export type ReceiptPageFilters = PageInput & {
  projectId?: number;
  projectIds?: number[];
  sourceType?: string;
  status?: string;
};

export async function listReceiptsPage(filters: ReceiptPageFilters) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const conditions: any[] = [];
  if (filters.projectId)
    conditions.push(eq(receipts.projectId, filters.projectId));
  addProjectScope(conditions, receipts.projectId, filters.projectIds);
  if (filters.sourceType)
    conditions.push(sql`${receipts.sourceType}::text = ${filters.sourceType}`);
  if (filters.status)
    conditions.push(sql`${receipts.status}::text = ${filters.status}`);
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const normalizedSearch = search.toLowerCase();
    conditions.push(
      or(
        ilike(receipts.receiptNumber, pattern),
        ilike(receipts.invoiceNumber, pattern),
        ilike(receipts.documentRangeStart, pattern),
        ilike(receipts.documentRangeEnd, pattern),
        ilike(purchaseOrders.orderNumber, pattern),
        ilike(suppliers.name, pattern),
        ilike(suppliers.supplierCode, pattern),
        ilike(suppliers.rtn, pattern),
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        "orden de compra".includes(normalizedSearch)
          ? eq(receipts.sourceType, "purchase_order" as any)
          : sql`false`,
        "traslado".includes(normalizedSearch)
          ? eq(receipts.sourceType, "transfer" as any)
          : sql`false`
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [totalRow] = await database
    .select({ count: count() })
    .from(receipts)
    .leftJoin(projects, eq(receipts.projectId, projects.id))
    .leftJoin(
      purchaseOrders,
      and(
        eq(receipts.sourceType, "purchase_order" as any),
        eq(receipts.sourceId, purchaseOrders.id)
      )
    )
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await database
    .select({ id: receipts.id })
    .from(receipts)
    .leftJoin(projects, eq(receipts.projectId, projects.id))
    .leftJoin(
      purchaseOrders,
      and(
        eq(receipts.sourceType, "purchase_order" as any),
        eq(receipts.sourceId, purchaseOrders.id)
      )
    )
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(where)
    .orderBy(desc(receipts.createdAt), desc(receipts.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const items = await data.listReceipts({
    ids: uniqueIds(idRows),
    projectId: filters.projectId,
    projectIds: filters.projectIds,
    sourceType: filters.sourceType,
    status: filters.status,
  });
  return pageResult(items, total, filters);
}

export type InvoicePageFilters = PageInput & {
  projectId?: number;
  projectIds?: number[];
  status?: string;
  statuses?: string[];
  excludeStatus?: string;
  supplierId?: number;
  dateFrom?: string;
  dateTo?: string;
};

export async function listInvoicesPage(filters: InvoicePageFilters) {
  const database = await data.getDb();
  if (!database) return pageResult([], 0, filters);
  const createdBy = alias(users, "invoice_page_created_by");
  const requestedBy = alias(users, "invoice_page_requested_by");
  const conditions: any[] = [];
  if (filters.projectId)
    conditions.push(eq(invoices.projectId, filters.projectId));
  addProjectScope(conditions, invoices.projectId, filters.projectIds);
  if (filters.status)
    conditions.push(sql`${invoices.status}::text = ${filters.status}`);
  if (filters.statuses?.length)
    conditions.push(
      sql`${invoices.status}::text in (${sql.join(
        filters.statuses.map(value => sql`${value}`),
        sql`, `
      )})`
    );
  if (filters.excludeStatus)
    conditions.push(sql`${invoices.status}::text <> ${filters.excludeStatus}`);
  if (filters.supplierId)
    conditions.push(eq(invoices.supplierId, filters.supplierId));
  if (filters.dateFrom)
    conditions.push(
      sql`${invoices.documentDate}::date >= ${filters.dateFrom}::date`
    );
  if (filters.dateTo)
    conditions.push(
      sql`${invoices.documentDate}::date <= ${filters.dateTo}::date`
    );
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const requestRows = await database
      .select({ id: invoiceItems.invoiceId })
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
      .leftJoin(requestedBy, eq(materialRequests.requestedById, requestedBy.id))
      .where(
        or(
          ilike(materialRequests.requestNumber, pattern),
          ilike(requestedBy.name, pattern),
          ilike(requestedBy.email, pattern)
        )
      );
    const invoiceIds = uniqueIds(requestRows);
    conditions.push(
      or(
        ilike(invoices.invoiceDocumentNumber, pattern),
        ilike(invoices.invoiceNumber, pattern),
        ilike(invoices.documentRangeStart, pattern),
        ilike(invoices.documentRangeEnd, pattern),
        ilike(invoices.cai, pattern),
        ilike(purchaseOrders.orderNumber, pattern),
        ilike(receipts.receiptNumber, pattern),
        ilike(suppliers.supplierCode, pattern),
        ilike(suppliers.name, pattern),
        ilike(suppliers.rtn, pattern),
        ilike(projects.code, pattern),
        ilike(projects.name, pattern),
        sql`concat_ws(' ', ${projects.code}, ${projects.name}) ilike ${pattern}`,
        ilike(createdBy.name, pattern),
        ilike(createdBy.email, pattern),
        invoiceIds.length > 0 ? inArray(invoices.id, invoiceIds) : sql`false`
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [totalRow] = await database
    .select({ count: count() })
    .from(invoices)
    .leftJoin(receipts, eq(invoices.receiptId, receipts.id))
    .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .leftJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(createdBy, eq(receipts.receivedById, createdBy.id))
    .where(where);
  const total = totalRow?.count ?? 0;
  const meta = getPageMeta(total, filters);
  const idRows = await database
    .select({ id: invoices.id })
    .from(invoices)
    .leftJoin(receipts, eq(invoices.receiptId, receipts.id))
    .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .leftJoin(projects, eq(invoices.projectId, projects.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(createdBy, eq(receipts.receivedById, createdBy.id))
    .where(where)
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(meta.pageSize)
    .offset(meta.offset);
  const items = await data.listInvoices({
    ids: uniqueIds(idRows),
    projectId: filters.projectId,
    projectIds: filters.projectIds,
    status: filters.status,
    statuses: filters.statuses,
    excludeStatus: filters.excludeStatus,
    supplierId: filters.supplierId,
  });
  return pageResult(items, total, filters);
}
