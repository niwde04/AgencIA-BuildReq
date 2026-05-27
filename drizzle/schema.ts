import {
  check,
  serial,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { PURCHASE_ORDER_TAX_VALUES } from "../shared/purchase-orders";

// ============================================================
// ENUMS
// ============================================================
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const buildreqRoleEnum = pgEnum("buildreq_role", [
  "ingeniero_residente",
  "jefe_bodega_central",
  "administracion_central",
  "administrador_proyecto",
  "bodeguero_proyecto",
  "contable",
]);
export const projectStatusEnum = pgEnum("project_status", [
  "activo",
  "inactivo",
  "completado",
]);
export const recipientEnum = pgEnum("recipient", [
  "bodega_central",
  "bodega_proyecto",
  "administrador_proyecto",
  "oficina_central",
  "solicitud_compra",
]);
export const requestTypeEnum = pgEnum("request_type", ["bienes", "servicios"]);
export const requestStatusEnum = pgEnum("request_status", [
  "borrador",
  "pendiente_aprobar",
  "en_espera",
  "en_proceso",
  "parcialmente_atendida",
  "flujo_completado",
  "cerrada",
  "cerrada_incompleta",
  "anulada",
]);
export const requestWorkflowStageEnum = pgEnum("request_workflow_stage", [
  "bodega_proyecto",
  "administrador_proyecto",
  "oficina_central",
  "compra_local",
  "compra_internacional",
  "traslado",
  "recepcion",
  "cerrada",
  "rechazada",
]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pendiente",
  "aprobada",
  "rechazada",
  "no_requiere",
]);
export const purchaseUrgencyEnum = pgEnum("purchase_urgency", [
  "urgente",
  "no_urgente",
]);
export const materialRequestTargetTypeEnum = pgEnum(
  "material_request_target_type",
  ["subproyecto", "activo_fijo"]
);
export const flowTypeEnum = pgEnum("flow_type", [
  "compra_directa",
  "despacho_bodega",
  "traslado_proyecto",
  "solicitud_compra",
]);
export const requestItemStatusEnum = pgEnum("request_item_status", [
  "pendiente",
  "parcial",
  "completo",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "linea_credito",
  "fondo_proyecto",
  "caja_chica",
]);
export const purchaseTypeEnum = pgEnum("purchase_type", [
  "local",
  "extranjera",
  "compra_directa",
]);
export const sapDocumentTypeEnum = pgEnum("sap_document_type", [
  "entrada_mercancia",
  "salida_inventario",
  "transferencia_inventario",
  "solicitud_compra",
  "orden_compra",
]);
export const supplyFlowStatusEnum = pgEnum("supply_flow_status", [
  "pendiente",
  "en_proceso",
  "completado",
  "cancelado",
]);
export const returnTypeEnum = pgEnum("return_type", [
  "devolucion_bodega_central",
  "devolucion_bodega_proyecto",
  "devolucion_entre_proyectos",
  "devolucion_proveedor",
]);
export const reasonCategoryEnum = pgEnum("reason_category", [
  "material_defectuoso",
  "excedente",
  "error_pedido",
  "cambio_especificacion",
  "otro",
]);
export const returnStatusEnum = pgEnum("return_status", [
  "pendiente",
  "aprobada",
  "en_transito",
  "recibida",
  "rechazada",
]);
export const purchaseRequestStatusEnum = pgEnum("purchase_request_status", [
  "pendiente",
  "en_revision",
  "aprobada",
  "rechazada",
  "parcialmente_convertida",
  "convertida",
  "anulada",
]);
export const purchaseOrderClassificationEnum = pgEnum(
  "purchase_order_classification",
  ["oc", "cd"]
);
export const contractPaymentFrequencyEnum = pgEnum(
  "contract_payment_frequency",
  ["semanal", "quincenal", "mensual", "trimestral", "semestral", "anual"]
);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "borrador",
  "emitida",
  "enviada",
  "parcialmente_recibida",
  "recibida",
  "anulada",
]);
export const purchaseOrderTaxCodeEnum = pgEnum(
  "purchase_order_tax_code",
  PURCHASE_ORDER_TAX_VALUES
);
export const documentDeliveryStatusEnum = pgEnum("document_delivery_status", [
  "pendiente",
  "enviado",
  "fallido",
]);
export const transferDestinationTypeEnum = pgEnum("transfer_destination_type", [
  "proyecto",
  "bodega_central",
]);
export const transferRequestStatusEnum = pgEnum("transfer_request_status", [
  "pendiente",
  "aprobada",
  "rechazada",
  "convertida",
  "anulada",
]);
export const transferStatusEnum = pgEnum("transfer_status", [
  "pendiente",
  "confirmado",
  "en_transito",
  "parcialmente_recibido",
  "recibido",
  "cerrado_incompleto",
  "anulado",
]);
export const receiptStatusEnum = pgEnum("receipt_status", [
  "pendiente",
  "parcial",
  "completa",
  "cierre_incompleto",
]);
export const warehouseExitStatusEnum = pgEnum("warehouse_exit_status", [
  "borrador",
  "emitida",
  "anulada",
]);
export const receiptSourceTypeEnum = pgEnum("receipt_source_type", [
  "purchase_order",
  "transfer",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "borrador",
  "revisada",
  "rechazada",
  "registrada",
  "anulada",
]);
export const supplierContactTypeEnum = pgEnum("supplier_contact_type", [
  "ventas",
  "compras",
  "cobros",
  "logistica",
  "administracion",
  "otro",
]);
export const invoiceRetentionTypeEnum = pgEnum("invoice_retention_type", [
  "percentage",
  "amount",
]);
export const itemConditionEnum = pgEnum("item_condition", [
  "nuevo",
  "usado_buen_estado",
  "defectuoso",
  "danado",
]);
export const attachmentEntityTypeEnum = pgEnum("attachment_entity_type", [
  "material_request",
  "supply_flow",
  "reverse_logistic",
  "purchase_request",
  "purchase_order",
  "transfer_request",
  "transfer",
  "receipt",
  "invoice",
  "supplier",
]);
export const attachmentCategoryEnum = pgEnum("attachment_category", [
  "factura",
  "orden_compra",
  "comprobante_entrega",
  "foto_material",
  "documento_proveedor",
  "otro",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "nueva_solicitud",
  "cambio_estatus",
  "solicitud_compra",
  "orden_compra",
  "traslado",
  "recepcion",
  "devolucion",
  "sistema",
]);
export const sapSyncEntityTypeEnum = pgEnum("sap_sync_entity_type", [
  "supply_flow",
  "reverse_logistic",
  "inventory",
]);
export const sapSyncStatusEnum = pgEnum("sap_sync_status", [
  "success",
  "error",
  "pending",
]);
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pendiente",
  "aceptada",
  "expirada",
  "cancelada",
]);
export const supplierDocumentExpirationModeEnum = pgEnum(
  "supplier_document_expiration_mode",
  ["required", "optional", "none"]
);

// ============================================================
// USERS - Extended with BuildReq roles
// ============================================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  /** BuildReq-specific role for business logic */
  buildreqRole: buildreqRoleEnum("buildreqRole"),
  /** If Ing. Residente, which project they are assigned to */
  assignedProjectId: integer("assignedProjectId"),
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// PROJECTS - Construction projects (up to 20 active)
// ============================================================
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    location: varchar("location", { length: 255 }),
    status: projectStatusEnum("status").default("activo").notNull(),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    /** SAP B1 project code for future integration */
    sapProjectCode: varchar("sapProjectCode", { length: 50 }),
    demoBatchKey: varchar("demoBatchKey", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    demoBatchIdx: index("proj_demo_batch_idx").on(table.demoBatchKey),
  })
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ============================================================
// PROJECT SUBPROJECTS - Informational child phases/work fronts
// ============================================================
export const projectSubprojects = pgTable(
  "projectSubprojects",
  {
    id: serial("id").primaryKey(),
    projectId: integer("projectId")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
      }),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    projectIdx: index("psp_project_idx").on(table.projectId),
    activeIdx: index("psp_active_idx").on(table.isActive),
    projectCodeUnique: uniqueIndex("psp_project_code_unique").on(
      table.projectId,
      table.code
    ),
  })
);

export type ProjectSubproject = typeof projectSubprojects.$inferSelect;
export type InsertProjectSubproject = typeof projectSubprojects.$inferInsert;

// ============================================================
// MATERIAL REQUESTS - Main request header
// ============================================================
export const materialRequests = pgTable(
  "materialRequests",
  {
    id: serial("id").primaryKey(),
    /** Auto-generated request number: REQ-PROJECT-00000001 */
    requestNumber: varchar("requestNumber", { length: 64 }).notNull().unique(),
    projectId: integer("projectId").notNull(),
    requestedById: integer("requestedById").notNull(),
    /** Who receives: bodega_central, administrador_proyecto, or solicitud_compra */
    recipient: recipientEnum("recipient").default("bodega_proyecto").notNull(),
    requestType: requestTypeEnum("requestType").default("bienes").notNull(),
    status: requestStatusEnum("status").default("en_espera").notNull(),
    workflowStage: requestWorkflowStageEnum("workflowStage")
      .default("bodega_proyecto")
      .notNull(),
    approvalStatus: approvalStatusEnum("approvalStatus")
      .default("no_requiere")
      .notNull(),
    rejectionReason: text("rejectionReason"),
    approvedById: integer("approvedById"),
    approvedAt: timestamp("approvedAt"),
    /** Urgent vs standard procurement planning */
    purchaseUrgency: purchaseUrgencyEnum("purchaseUrgency")
      .default("no_urgente")
      .notNull(),
    /** Requested date by which the requisition is needed */
    neededBy: timestamp("neededBy"),
    notes: text("notes"),
    /** Which supply flow was assigned */
    assignedFlow: flowTypeEnum("assignedFlow"),
    /** User who processed/assigned the flow */
    processedById: integer("processedById"),
    processedAt: timestamp("processedAt"),
    closedAt: timestamp("closedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    projectIdx: index("mr_project_idx").on(table.projectId),
    statusIdx: index("mr_status_idx").on(table.status),
    requestedByIdx: index("mr_requested_by_idx").on(table.requestedById),
  })
);

export type MaterialRequest = typeof materialRequests.$inferSelect;
export type InsertMaterialRequest = typeof materialRequests.$inferInsert;

// ============================================================
// REQUEST ITEMS - Line items for each material request
// ============================================================
export const requestItems = pgTable(
  "requestItems",
  {
    id: serial("id").primaryKey(),
    requestId: integer("requestId").notNull(),
    /** Free-text item name as entered by Ing. Residente */
    itemName: varchar("itemName", { length: 500 }).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    /** Per-item authorization by Project Administrator before SAP/flow */
    approvalStatus: approvalStatusEnum("approvalStatus")
      .default("no_requiere")
      .notNull(),
    approvedById: integer("approvedById"),
    approvedAt: timestamp("approvedAt"),
    rejectionReason: text("rejectionReason"),
    /** SAP item code - filled by Jefe de Bodega when translating */
    sapItemCode: varchar("sapItemCode", { length: 50 }),
    /** SAP item description after translation */
    sapItemDescription: varchar("sapItemDescription", { length: 500 }),
    targetType: materialRequestTargetTypeEnum("targetType"),
    subProjectId: integer("subProjectId").references(
      () => projectSubprojects.id,
      {
        onDelete: "set null",
      }
    ),
    fixedAssetSapItemCode: varchar("fixedAssetSapItemCode", { length: 50 }),
    fixedAssetName: varchar("fixedAssetName", { length: 500 }),
    /** Which supply flow was assigned to this specific item */
    assignedFlow: flowTypeEnum("assignedFlow"),
    /** Quantity actually delivered/fulfilled */
    deliveredQuantity: decimal("deliveredQuantity", {
      precision: 12,
      scale: 2,
    }),
    dispatchedQuantity: decimal("dispatchedQuantity", {
      precision: 12,
      scale: 2,
    }),
    committedQuantity: decimal("committedQuantity", {
      precision: 12,
      scale: 2,
    }),
    projectStock: decimal("projectStock", { precision: 12, scale: 2 }),
    sapStock: decimal("sapStock", { precision: 12, scale: 2 }),
    warehouseExitNote: text("warehouseExitNote"),
    status: requestItemStatusEnum("status").default("pendiente").notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    requestIdx: index("ri_request_idx").on(table.requestId),
    subProjectIdx: index("ri_subproject_idx").on(table.subProjectId),
    fixedAssetIdx: index("ri_fixed_asset_idx").on(table.fixedAssetSapItemCode),
  })
);

export type RequestItem = typeof requestItems.$inferSelect;
export type InsertRequestItem = typeof requestItems.$inferInsert;

// ============================================================
// SUPPLY FLOW RECORDS - Tracks which flow path was executed
// ============================================================
export const supplyFlowRecords = pgTable(
  "supplyFlowRecords",
  {
    id: serial("id").primaryKey(),
    requestId: integer("requestId").notNull(),
    /** Link to specific request item for item-level flow assignment */
    requestItemId: integer("requestItemId"),
    flowType: flowTypeEnum("flowType").notNull(),

    // --- Flow 1: Compra directa ---
    paymentMethod: paymentMethodEnum("paymentMethod"),
    supplierId: integer("supplierId"),

    // --- Flow 2: Despacho bodega ---
    sourceWarehouse: varchar("sourceWarehouse", { length: 100 }),

    // --- Flow 3: Traslado entre proyectos ---
    sourceProjectId: integer("sourceProjectId"),
    destinationProjectId: integer("destinationProjectId"),

    // --- Flow 4: Solicitud de compra ---
    purchaseType: purchaseTypeEnum("purchaseType"),
    purchaseOrderNumber: varchar("purchaseOrderNumber", { length: 64 }),

    // --- SAP Integration fields ---
    sapDocumentType: sapDocumentTypeEnum("sapDocumentType"),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 64 }),
    sapSynced: boolean("sapSynced").default(false).notNull(),
    sapSyncedAt: timestamp("sapSyncedAt"),
    sapSyncError: text("sapSyncError"),

    status: supplyFlowStatusEnum("status").default("pendiente").notNull(),
    processedById: integer("processedById"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    requestIdx: index("sfr_request_idx").on(table.requestId),
    flowTypeIdx: index("sfr_flow_type_idx").on(table.flowType),
  })
);

export type SupplyFlowRecord = typeof supplyFlowRecords.$inferSelect;
export type InsertSupplyFlowRecord = typeof supplyFlowRecords.$inferInsert;

// ============================================================
// PURCHASE REQUESTS - Formal purchase request module
// ============================================================
export const purchaseRequests = pgTable(
  "purchaseRequests",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("requestNumber", { length: 64 }).notNull().unique(),
    materialRequestId: integer("materialRequestId"),
    sourcePurchaseOrderId: integer("sourcePurchaseOrderId"),
    projectId: integer("projectId").notNull(),
    createdById: integer("createdById").notNull(),
    purchaseType: purchaseTypeEnum("purchaseType").notNull(),
    status: purchaseRequestStatusEnum("status").default("pendiente").notNull(),
    neededBy: timestamp("neededBy"),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 64 }),
    printDestination: varchar("printDestination", { length: 500 }),
    notes: text("notes"),
    rejectionReason: text("rejectionReason"),
    printedDocumentName: varchar("printedDocumentName", { length: 255 }),
    printedDocumentMimeType: varchar("printedDocumentMimeType", {
      length: 100,
    }),
    printedDocumentContent: text("printedDocumentContent"),
    printedAt: timestamp("printedAt"),
    quoteAttachmentId: integer("quoteAttachmentId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    projectIdx: index("pr_project_idx").on(table.projectId),
    materialRequestIdx: index("pr_material_request_idx").on(
      table.materialRequestId
    ),
    sourcePurchaseOrderIdx: index("pr_source_purchase_order_idx").on(
      table.sourcePurchaseOrderId
    ),
    statusIdx: index("pr_status_idx").on(table.status),
  })
);

export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type InsertPurchaseRequest = typeof purchaseRequests.$inferInsert;

export const purchaseRequestItems = pgTable(
  "purchaseRequestItems",
  {
    id: serial("id").primaryKey(),
    purchaseRequestId: integer("purchaseRequestId").notNull(),
    materialRequestItemId: integer("materialRequestItemId"),
    sourcePurchaseOrderItemId: integer("sourcePurchaseOrderItemId"),
    originalSapItemCode: varchar("originalSapItemCode", { length: 50 }),
    currentSapItemCode: varchar("currentSapItemCode", { length: 50 }),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    convertedQuantity: decimal("convertedQuantity", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    receivedQuantity: decimal("receivedQuantity", { precision: 12, scale: 2 }),
    unit: varchar("unit", { length: 50 }),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    brand: varchar("brand", { length: 255 }),
    costResponsible: varchar("costResponsible", { length: 255 }),
    targetType: materialRequestTargetTypeEnum("targetType"),
    subProjectId: integer("subProjectId").references(
      () => projectSubprojects.id,
      {
        onDelete: "set null",
      }
    ),
    fixedAssetSapItemCode: varchar("fixedAssetSapItemCode", { length: 50 }),
    fixedAssetName: varchar("fixedAssetName", { length: 500 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    purchaseRequestIdx: index("pri_purchase_request_idx").on(
      table.purchaseRequestId
    ),
    subProjectIdx: index("pri_subproject_idx").on(table.subProjectId),
    fixedAssetIdx: index("pri_fixed_asset_idx").on(table.fixedAssetSapItemCode),
  })
);

export type PurchaseRequestItem = typeof purchaseRequestItems.$inferSelect;
export type InsertPurchaseRequestItem =
  typeof purchaseRequestItems.$inferInsert;

// ============================================================
// PURCHASE ORDERS - Formal order module
// ============================================================
export const purchaseOrders = pgTable(
  "purchaseOrders",
  {
    id: serial("id").primaryKey(),
    orderNumber: varchar("orderNumber", { length: 64 }).notNull().unique(),
    purchaseRequestId: integer("purchaseRequestId"),
    projectId: integer("projectId").notNull(),
    classification: purchaseOrderClassificationEnum("classification")
      .default("oc")
      .notNull(),
    purchaseType: purchaseTypeEnum("purchaseType"),
    supplierId: integer("supplierId"),
    supplierEmail: varchar("supplierEmail", { length: 320 }),
    supplierContactId: integer("supplierContactId").references(
      () => supplierContacts.id,
      { onDelete: "set null" }
    ),
    salesAdvisorName: varchar("salesAdvisorName", { length: 255 }),
    salesAdvisorPhone: varchar("salesAdvisorPhone", { length: 80 }),
    salesAdvisorEmail: varchar("salesAdvisorEmail", { length: 320 }),
    status: purchaseOrderStatusEnum("status").default("borrador").notNull(),
    neededBy: timestamp("neededBy"),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 64 }),
    notes: text("notes"),
    printedDocumentName: varchar("printedDocumentName", { length: 255 }),
    printedDocumentMimeType: varchar("printedDocumentMimeType", {
      length: 100,
    }),
    printedDocumentContent: text("printedDocumentContent"),
    printedAt: timestamp("printedAt"),
    emailStatus: documentDeliveryStatusEnum("emailStatus")
      .default("pendiente")
      .notNull(),
    emailedAt: timestamp("emailedAt"),
    emailError: text("emailError"),
    appliesContract: boolean("appliesContract").default(false).notNull(),
    contractPaymentFrequency: contractPaymentFrequencyEnum(
      "contractPaymentFrequency"
    ),
    contractFirstPaymentDate: timestamp("contractFirstPaymentDate"),
    contractEndDate: timestamp("contractEndDate"),
    contractExpiryNotifiedAt: timestamp("contractExpiryNotifiedAt"),
    createdById: integer("createdById").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    purchaseRequestIdx: index("po_purchase_request_idx").on(
      table.purchaseRequestId
    ),
    projectIdx: index("po_project_idx").on(table.projectId),
    supplierContactIdx: index("po_supplier_contact_idx").on(
      table.supplierContactId
    ),
    statusIdx: index("po_status_idx").on(table.status),
  })
);

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;

export const purchaseOrderAuditLogs = pgTable(
  "purchaseOrderAuditLogs",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: integer("purchaseOrderId").notNull(),
    purchaseOrderItemId: integer("purchaseOrderItemId"),
    action: varchar("action", { length: 80 }).notNull(),
    field: varchar("field", { length: 100 }).notNull(),
    oldValue: text("oldValue"),
    newValue: text("newValue"),
    changedById: integer("changedById").notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    purchaseOrderIdx: index("po_audit_order_idx").on(table.purchaseOrderId),
    purchaseOrderItemIdx: index("po_audit_item_idx").on(
      table.purchaseOrderItemId
    ),
    changedByIdx: index("po_audit_changed_by_idx").on(table.changedById),
  })
);

export type PurchaseOrderAuditLog =
  typeof purchaseOrderAuditLogs.$inferSelect;
export type InsertPurchaseOrderAuditLog =
  typeof purchaseOrderAuditLogs.$inferInsert;

export const purchaseOrderItems = pgTable(
  "purchaseOrderItems",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: integer("purchaseOrderId").notNull(),
    purchaseRequestItemId: integer("purchaseRequestItemId"),
    materialRequestItemId: integer("materialRequestItemId"),
    originalSapItemCode: varchar("originalSapItemCode", { length: 50 }),
    currentSapItemCode: varchar("currentSapItemCode", { length: 50 }),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    receivedQuantity: decimal("receivedQuantity", { precision: 12, scale: 2 }),
    unit: varchar("unit", { length: 50 }),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    taxCode: purchaseOrderTaxCodeEnum("taxCode").default("exe").notNull(),
    receiptClosed: boolean("receiptClosed").default(false).notNull(),
    receiptClosedAt: timestamp("receiptClosedAt"),
    receiptClosedById: integer("receiptClosedById"),
    receiptCloseNote: text("receiptCloseNote"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    purchaseOrderIdx: index("poi_purchase_order_idx").on(table.purchaseOrderId),
  })
);

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type InsertPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;

// ============================================================
// TRANSFER REQUESTS / TRANSFERS
// ============================================================
export const transferRequests = pgTable(
  "transferRequests",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("requestNumber", { length: 64 }).notNull().unique(),
    materialRequestId: integer("materialRequestId"),
    projectId: integer("projectId").notNull(),
    destinationType: transferDestinationTypeEnum("destinationType").notNull(),
    destinationProjectId: integer("destinationProjectId"),
    createdById: integer("createdById").notNull(),
    status: transferRequestStatusEnum("status").default("pendiente").notNull(),
    neededBy: timestamp("neededBy"),
    notes: text("notes"),
    rejectionReason: text("rejectionReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    projectIdx: index("tr_project_idx").on(table.projectId),
    materialRequestIdx: index("tr_material_request_idx").on(
      table.materialRequestId
    ),
    statusIdx: index("tr_status_idx").on(table.status),
  })
);

export type TransferRequest = typeof transferRequests.$inferSelect;
export type InsertTransferRequest = typeof transferRequests.$inferInsert;

export const transferRequestItems = pgTable(
  "transferRequestItems",
  {
    id: serial("id").primaryKey(),
    transferRequestId: integer("transferRequestId").notNull(),
    materialRequestItemId: integer("materialRequestItemId"),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    sapItemCode: varchar("sapItemCode", { length: 50 }),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    receivedQuantity: decimal("receivedQuantity", { precision: 12, scale: 2 }),
    returnedToOriginQuantity: decimal("returnedToOriginQuantity", {
      precision: 12,
      scale: 2,
    })
      .default("0")
      .notNull(),
    receiptClosed: boolean("receiptClosed").default(false).notNull(),
    receiptClosedAt: timestamp("receiptClosedAt"),
    receiptClosedById: integer("receiptClosedById"),
    receiptCloseReason: varchar("receiptCloseReason", { length: 120 }),
    receiptCloseNote: text("receiptCloseNote"),
    unit: varchar("unit", { length: 50 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    transferRequestIdx: index("tri_transfer_request_idx").on(
      table.transferRequestId
    ),
  })
);

export type TransferRequestItem = typeof transferRequestItems.$inferSelect;
export type InsertTransferRequestItem =
  typeof transferRequestItems.$inferInsert;

export const transfers = pgTable(
  "transfers",
  {
    id: serial("id").primaryKey(),
    transferNumber: varchar("transferNumber", { length: 64 })
      .notNull()
      .unique(),
    transferRequestId: integer("transferRequestId").notNull(),
    status: transferStatusEnum("status").default("pendiente").notNull(),
    remissionGuideNumber: varchar("remissionGuideNumber", { length: 64 }),
    sapCorrelative: varchar("sapCorrelative", { length: 80 }),
    confirmedById: integer("confirmedById"),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    transferRequestIdx: index("tf_transfer_request_idx").on(
      table.transferRequestId
    ),
    statusIdx: index("tf_status_idx").on(table.status),
  })
);

export type Transfer = typeof transfers.$inferSelect;
export type InsertTransfer = typeof transfers.$inferInsert;

export const remissionGuides = pgTable(
  "remissionGuides",
  {
    id: serial("id").primaryKey(),
    guideNumber: varchar("guideNumber", { length: 64 }).notNull().unique(),
    transferId: integer("transferId").notNull(),
    sapCorrelative: varchar("sapCorrelative", { length: 80 }).notNull(),
    documentName: varchar("documentName", { length: 255 }),
    documentMimeType: varchar("documentMimeType", { length: 100 }),
    documentContent: text("documentContent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    transferIdx: index("rg_transfer_idx").on(table.transferId),
  })
);

export type RemissionGuide = typeof remissionGuides.$inferSelect;
export type InsertRemissionGuide = typeof remissionGuides.$inferInsert;

// ============================================================
// RECEIPTS
// ============================================================
export const receipts = pgTable(
  "receipts",
  {
    id: serial("id").primaryKey(),
    receiptNumber: varchar("receiptNumber", { length: 64 }).notNull().unique(),
    sourceType: receiptSourceTypeEnum("sourceType").notNull(),
    sourceId: integer("sourceId").notNull(),
    projectId: integer("projectId").notNull(),
    receivedById: integer("receivedById").notNull(),
    status: receiptStatusEnum("status").default("pendiente").notNull(),
    isFiscalDocument: boolean("isFiscalDocument").default(false).notNull(),
    cai: varchar("cai", { length: 100 }),
    invoiceNumber: varchar("invoiceNumber", { length: 100 }),
    documentDate: timestamp("documentDate"),
    documentDueDate: timestamp("documentDueDate"),
    postingDate: timestamp("postingDate").defaultNow().notNull(),
    receiptDate: timestamp("receiptDate").defaultNow().notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    sourceIdx: index("rec_source_idx").on(table.sourceType, table.sourceId),
    projectIdx: index("rec_project_idx").on(table.projectId),
  })
);

export type Receipt = typeof receipts.$inferSelect;
export type InsertReceipt = typeof receipts.$inferInsert;

export const receiptItems = pgTable(
  "receiptItems",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receiptId").notNull(),
    sourceItemId: integer("sourceItemId").notNull(),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    quantityExpected: decimal("quantityExpected", {
      precision: 12,
      scale: 2,
    }).notNull(),
    quantityReceived: decimal("quantityReceived", {
      precision: 12,
      scale: 2,
    }).notNull(),
    unit: varchar("unit", { length: 50 }),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    receiptIdx: index("reci_receipt_idx").on(table.receiptId),
  })
);

export type ReceiptItem = typeof receiptItems.$inferSelect;
export type InsertReceiptItem = typeof receiptItems.$inferInsert;

// ============================================================
// INVOICES
// ============================================================
export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    invoiceDocumentNumber: varchar("invoiceDocumentNumber", {
      length: 64,
    })
      .notNull()
      .unique(),
    receiptId: integer("receiptId").notNull().unique(),
    purchaseOrderId: integer("purchaseOrderId").notNull(),
    projectId: integer("projectId").notNull(),
    supplierId: integer("supplierId"),
    status: invoiceStatusEnum("status").default("borrador").notNull(),
    isFiscalDocument: boolean("isFiscalDocument").default(false).notNull(),
    cai: varchar("cai", { length: 100 }),
    invoiceNumber: varchar("invoiceNumber", { length: 100 }),
    documentDate: timestamp("documentDate"),
    documentDueDate: timestamp("documentDueDate"),
    postingDate: timestamp("postingDate").notNull(),
    receiptDate: timestamp("receiptDate").notNull(),
    emissionDeadline: timestamp("emissionDeadline").notNull(),
    notes: text("notes"),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    taxAmount: decimal("taxAmount", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    total: decimal("total", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    retentionTotal: decimal("retentionTotal", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    netPayable: decimal("netPayable", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    reviewedById: integer("reviewedById"),
    reviewedAt: timestamp("reviewedAt"),
    accountedById: integer("accountedById"),
    accountedAt: timestamp("accountedAt"),
    accountingComment: text("accountingComment"),
    rejectionComment: text("rejectionComment"),
    rejectedById: integer("rejectedById"),
    rejectedAt: timestamp("rejectedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    receiptIdx: uniqueIndex("inv_receipt_idx").on(table.receiptId),
    purchaseOrderIdx: index("inv_purchase_order_idx").on(table.purchaseOrderId),
    projectIdx: index("invoice_project_idx").on(table.projectId),
    supplierIdx: index("inv_supplier_idx").on(table.supplierId),
    statusIdx: index("invoice_status_idx").on(table.status),
  })
);

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

export const invoiceItems = pgTable(
  "invoiceItems",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoiceId").notNull(),
    receiptItemId: integer("receiptItemId").notNull(),
    purchaseOrderItemId: integer("purchaseOrderItemId").notNull(),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    currentSapItemCode: varchar("currentSapItemCode", { length: 50 }),
    originalSapItemCode: varchar("originalSapItemCode", { length: 50 }),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    taxCode: purchaseOrderTaxCodeEnum("taxCode").default("exe").notNull(),
    allowsTaxWithholding: boolean("allowsTaxWithholding")
      .default(true)
      .notNull(),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    taxAmount: decimal("taxAmount", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    total: decimal("total", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    invoiceIdx: index("invi_invoice_idx").on(table.invoiceId),
    receiptItemIdx: uniqueIndex("invi_receipt_item_idx").on(
      table.receiptItemId
    ),
    purchaseOrderItemIdx: index("invi_purchase_order_item_idx").on(
      table.purchaseOrderItemId
    ),
  })
);

export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertInvoiceItem = typeof invoiceItems.$inferInsert;

export const taxRetentions = pgTable(
  "taxRetentions",
  {
    id: serial("id").primaryKey(),
    taxCode: varchar("taxCode", { length: 50 }).notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    ratePercent: decimal("ratePercent", { precision: 8, scale: 4 }).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    note: text("note"),
    erpCode: varchar("erpCode", { length: 50 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    taxCodeIdx: uniqueIndex("tax_ret_tax_code_idx").on(table.taxCode),
    activeIdx: index("tax_ret_active_idx").on(table.isActive),
  })
);

export type TaxRetention = typeof taxRetentions.$inferSelect;
export type InsertTaxRetention = typeof taxRetentions.$inferInsert;

export const invoiceRetentions = pgTable(
  "invoiceRetentions",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoiceId").notNull(),
    invoiceItemId: integer("invoiceItemId").references(() => invoiceItems.id, {
      onDelete: "cascade",
    }),
    retentionCatalogId: integer("retentionCatalogId").references(
      () => taxRetentions.id,
      { onDelete: "set null" }
    ),
    retentionCode: varchar("retentionCode", { length: 50 }),
    retentionErpCode: varchar("retentionErpCode", { length: 50 }),
    retentionType: invoiceRetentionTypeEnum("retentionType").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    baseAmount: decimal("baseAmount", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    percentage: decimal("percentage", { precision: 8, scale: 4 }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    invoiceIdx: index("invr_invoice_idx").on(table.invoiceId),
    invoiceItemIdx: index("invr_invoice_item_idx").on(table.invoiceItemId),
    retentionCatalogIdx: index("invr_retention_catalog_idx").on(
      table.retentionCatalogId
    ),
  })
);

export type InvoiceRetention = typeof invoiceRetentions.$inferSelect;
export type InsertInvoiceRetention = typeof invoiceRetentions.$inferInsert;

// ============================================================
// WAREHOUSE EXITS - Formal outbound inventory transactions
// ============================================================
export const warehouseExits = pgTable(
  "warehouseExits",
  {
    id: serial("id").primaryKey(),
    exitNumber: varchar("exitNumber", { length: 64 }).notNull().unique(),
    projectId: integer("projectId").notNull(),
    warehouseId: integer("warehouseId").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    materialRequestId: integer("materialRequestId"),
    createdById: integer("createdById").notNull(),
    emittedById: integer("emittedById"),
    cancelledById: integer("cancelledById"),
    status: warehouseExitStatusEnum("status").default("borrador").notNull(),
    exitDate: timestamp("exitDate").defaultNow().notNull(),
    emittedAt: timestamp("emittedAt"),
    cancelledAt: timestamp("cancelledAt"),
    cancellationReason: text("cancellationReason"),
    notes: text("notes"),
    printedDocumentName: varchar("printedDocumentName", { length: 255 }),
    printedDocumentMimeType: varchar("printedDocumentMimeType", {
      length: 100,
    }),
    printedDocumentContent: text("printedDocumentContent"),
    printedAt: timestamp("printedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    projectIdx: index("we_project_idx").on(table.projectId),
    warehouseIdx: index("we_warehouse_idx").on(table.warehouseId),
    materialRequestIdx: index("we_material_request_idx").on(
      table.materialRequestId
    ),
    statusIdx: index("we_status_idx").on(table.status),
    createdByIdx: index("we_created_by_idx").on(table.createdById),
  })
);

export type WarehouseExit = typeof warehouseExits.$inferSelect;
export type InsertWarehouseExit = typeof warehouseExits.$inferInsert;

export const warehouseExitItems = pgTable(
  "warehouseExitItems",
  {
    id: serial("id").primaryKey(),
    warehouseExitId: integer("warehouseExitId").notNull(),
    materialRequestItemId: integer("materialRequestItemId"),
    sapItemCode: varchar("sapItemCode", { length: 50 }).notNull(),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    warehouseExitIdx: index("wei_warehouse_exit_idx").on(table.warehouseExitId),
    requestItemIdx: index("wei_request_item_idx").on(
      table.materialRequestItemId
    ),
    sapCodeIdx: index("wei_sap_code_idx").on(table.sapItemCode),
  })
);

export type WarehouseExitItem = typeof warehouseExitItems.$inferSelect;
export type InsertWarehouseExitItem = typeof warehouseExitItems.$inferInsert;

// ============================================================
// OPENING BALANCES - Initial stock load for project warehouses
// ============================================================
export const openingBalances = pgTable(
  "openingBalances",
  {
    id: serial("id").primaryKey(),
    balanceNumber: varchar("balanceNumber", { length: 64 }).notNull().unique(),
    projectId: integer("projectId").notNull(),
    warehouseId: integer("warehouseId").notNull().unique(),
    createdById: integer("createdById").notNull(),
    openingDate: timestamp("openingDate").defaultNow().notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    projectIdx: index("ob_project_idx").on(table.projectId),
    warehouseIdx: index("ob_warehouse_idx").on(table.warehouseId),
    createdByIdx: index("ob_created_by_idx").on(table.createdById),
  })
);

export type OpeningBalance = typeof openingBalances.$inferSelect;
export type InsertOpeningBalance = typeof openingBalances.$inferInsert;

export const openingBalanceItems = pgTable(
  "openingBalanceItems",
  {
    id: serial("id").primaryKey(),
    openingBalanceId: integer("openingBalanceId").notNull(),
    sapItemCode: varchar("sapItemCode", { length: 50 }).notNull(),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    openingBalanceIdx: index("obi_opening_balance_idx").on(
      table.openingBalanceId
    ),
    sapCodeIdx: index("obi_sap_code_idx").on(table.sapItemCode),
  })
);

export type OpeningBalanceItem = typeof openingBalanceItems.$inferSelect;
export type InsertOpeningBalanceItem = typeof openingBalanceItems.$inferInsert;

// ============================================================
// REVERSE LOGISTICS - Returns and defects
// ============================================================
export const reverseLogistics = pgTable(
  "reverseLogistics",
  {
    id: serial("id").primaryKey(),
    /** Auto-generated: DEV-PROJECT-00000001 */
    returnNumber: varchar("returnNumber", { length: 64 }).notNull().unique(),
    returnType: returnTypeEnum("returnType").notNull(),
    reasonCategory: reasonCategoryEnum("reasonCategory").notNull(),
    /** MANDATORY justification text */
    justification: text("justification").notNull(),
    sourceProjectId: integer("sourceProjectId").notNull(),
    destinationProjectId: integer("destinationProjectId"),
    sourceWarehouseExitId: integer("sourceWarehouseExitId"),
    sourceReceiptId: integer("sourceReceiptId"),
    supplierName: varchar("supplierName", { length: 255 }),
    originalRequestId: integer("originalRequestId"),
    status: returnStatusEnum("status").default("pendiente").notNull(),
    sapDocumentType: varchar("sapDocumentType", { length: 50 }),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 64 }),
    sapSynced: boolean("sapSynced").default(false).notNull(),
    createdById: integer("createdById").notNull(),
    processedById: integer("processedById"),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    sourceProjectIdx: index("rl_source_project_idx").on(table.sourceProjectId),
    sourceReceiptIdx: index("rl_source_receipt_idx").on(table.sourceReceiptId),
    returnTypeIdx: index("rl_return_type_idx").on(table.returnType),
    statusIdx: index("rl_status_idx").on(table.status),
  })
);

export type ReverseLogistic = typeof reverseLogistics.$inferSelect;
export type InsertReverseLogistic = typeof reverseLogistics.$inferInsert;

// ============================================================
// REVERSE LOGISTICS ITEMS - Items being returned
// ============================================================
export const reverseLogisticsItems = pgTable(
  "reverseLogisticsItems",
  {
    id: serial("id").primaryKey(),
    reverseLogisticId: integer("reverseLogisticId").notNull(),
    sourceWarehouseExitItemId: integer("sourceWarehouseExitItemId"),
    itemName: varchar("itemName", { length: 500 }).notNull(),
    sapItemCode: varchar("sapItemCode", { length: 50 }),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    condition: itemConditionEnum("condition").default("nuevo").notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    reverseLogisticIdx: index("rli_reverse_logistic_idx").on(
      table.reverseLogisticId
    ),
    sourceWarehouseExitItemIdx: index("rli_source_warehouse_exit_item_idx").on(
      table.sourceWarehouseExitItemId
    ),
  })
);

export type ReverseLogisticItem = typeof reverseLogisticsItems.$inferSelect;
export type InsertReverseLogisticItem =
  typeof reverseLogisticsItems.$inferInsert;

// ============================================================
// ATTACHMENTS - S3-stored files
// ============================================================
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    entityType: attachmentEntityTypeEnum("entityType").notNull(),
    entityId: integer("entityId").notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    fileKey: varchar("fileKey", { length: 500 }).notNull(),
    fileUrl: varchar("fileUrl", { length: 1000 }).notNull(),
    mimeType: varchar("mimeType", { length: 100 }),
    fileSize: integer("fileSize"),
    category: attachmentCategoryEnum("category"),
    uploadedById: integer("uploadedById").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    entityIdx: index("att_entity_idx").on(table.entityType, table.entityId),
  })
);

export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;

// ============================================================
// NOTIFICATIONS - In-app notifications
// ============================================================
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    type: notificationTypeEnum("type").notNull(),
    relatedEntityType: varchar("relatedEntityType", { length: 50 }),
    relatedEntityId: integer("relatedEntityId"),
    isRead: boolean("isRead").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("notif_user_idx").on(table.userId),
    readIdx: index("notif_read_idx").on(table.userId, table.isRead),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ============================================================
// WAREHOUSES - Physical warehouse locations
// ============================================================
export const warehouses = pgTable(
  "warehouses",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    displayName: varchar("displayName", { length: 300 }).notNull().unique(),
    projectId: integer("projectId")
      .references(() => projects.id, {
        onDelete: "set null",
      })
      .unique(),
    description: text("description"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    codeIdx: index("wh_code_idx").on(table.code),
    displayNameIdx: index("wh_display_name_idx").on(table.displayName),
    projectIdx: index("wh_project_idx").on(table.projectId),
  })
);

export type Warehouse = typeof warehouses.$inferSelect;
export type InsertWarehouse = typeof warehouses.$inferInsert;

// ============================================================
// INVENTORY ITEMS - For tracking stock (Bodega Central view)
// ============================================================
export const inventoryItems = pgTable(
  "inventoryItems",
  {
    id: serial("id").primaryKey(),
    sapItemCode: varchar("sapItemCode", { length: 50 }).notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    description: text("description"),
    unit: varchar("unit", { length: 50 }),
    category: varchar("category", { length: 100 }),
    currentStock: decimal("currentStock", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    minimumStock: decimal("minimumStock", { precision: 12, scale: 2 }),
    projectId: integer("projectId"),
    warehouseId: integer("warehouseId").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    warehouseLocation: varchar("warehouseLocation", { length: 100 }),
    isActive: boolean("isActive").default(true).notNull(),
    demoBatchKey: varchar("demoBatchKey", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    sapCodeIdx: index("inv_sap_code_idx").on(table.sapItemCode),
    categoryIdx: index("inv_category_idx").on(table.category),
    projectIdx: index("inv_project_idx").on(table.projectId),
    warehouseIdx: index("inv_warehouse_idx").on(table.warehouseId),
    demoBatchIdx: index("inv_demo_batch_idx").on(table.demoBatchKey),
  })
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = typeof inventoryItems.$inferInsert;

// ============================================================
// SAP SYNC LOG - Audit trail for SAP integration
// ============================================================
export const sapSyncLog = pgTable(
  "sapSyncLog",
  {
    id: serial("id").primaryKey(),
    entityType: sapSyncEntityTypeEnum("entityType").notNull(),
    entityId: integer("entityId").notNull(),
    sapDocumentType: varchar("sapDocumentType", { length: 50 }).notNull(),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 64 }),
    requestPayload: text("requestPayload"),
    responsePayload: text("responsePayload"),
    status: sapSyncStatusEnum("status").default("pending").notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    entityIdx: index("sap_entity_idx").on(table.entityType, table.entityId),
  })
);

export type SapSyncLogEntry = typeof sapSyncLog.$inferSelect;
export type InsertSapSyncLogEntry = typeof sapSyncLog.$inferInsert;

// ============================================================
// INVITATIONS - User invitations by admin
// ============================================================
export const invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    buildreqRole: buildreqRoleEnum("buildreqRole").notNull(),
    assignedProjectId: integer("assignedProjectId"),
    status: invitationStatusEnum("status").default("pendiente").notNull(),
    invitedById: integer("invitedById").notNull(),
    acceptedAt: timestamp("acceptedAt"),
    acceptedUserId: integer("acceptedUserId"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    emailIdx: index("inv_email_idx").on(table.email),
    tokenIdx: index("inv_token_idx").on(table.token),
    statusIdx: index("inv_status_idx").on(table.status),
  })
);

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;

// ============================================================
// SAP CATALOG - Master catalog of SAP items for autocomplete
// ============================================================
export const sapCatalog = pgTable(
  "sapCatalog",
  {
    id: serial("id").primaryKey(),
    itemCode: varchar("itemCode", { length: 50 }).notNull().unique(),
    description: varchar("description", { length: 500 }).notNull(),
    itemGroup: varchar("itemGroup", { length: 255 }),
    tipoArticulo: integer("tipoArticulo").default(1).notNull(),
    projectId: integer("projectId").references(() => projects.id, {
      onDelete: "set null",
    }),
    allowsTaxWithholding: boolean("allowsTaxWithholding")
      .default(true)
      .notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    demoBatchKey: varchar("demoBatchKey", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    codeIdx: index("sap_cat_code_idx").on(table.itemCode),
    descIdx: index("sap_cat_desc_idx").on(table.description),
    tipoArticuloIdx: index("sap_cat_tipo_articulo_idx").on(table.tipoArticulo),
    projectIdx: index("sap_cat_project_idx").on(table.projectId),
    demoBatchIdx: index("sap_cat_demo_batch_idx").on(table.demoBatchKey),
    tipoArticuloCheck: check(
      "sapCatalog_tipoArticulo_check",
      sql`${table.tipoArticulo} in (1, 2, 3)`
    ),
  })
);

export type SapCatalogItem = typeof sapCatalog.$inferSelect;
export type InsertSapCatalogItem = typeof sapCatalog.$inferInsert;

// ============================================================
// SUPPLIERS - Vendor/supplier catalog
// ============================================================
export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    supplierCode: varchar("supplierCode", { length: 50 }).notNull().unique(),
    name: varchar("name", { length: 500 }).notNull(),
    email: varchar("email", { length: 320 }),
    allowsTaxWithholding: boolean("allowsTaxWithholding")
      .default(true)
      .notNull(),
    subjectToAccountPayments: boolean("subjectToAccountPayments")
      .default(true)
      .notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    demoBatchKey: varchar("demoBatchKey", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    codeIdx: index("sup_code_idx").on(table.supplierCode),
    demoBatchIdx: index("sup_demo_batch_idx").on(table.demoBatchKey),
  })
);

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

export const supplierContacts = pgTable(
  "supplierContacts",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplierId")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    projectId: integer("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactType: supplierContactTypeEnum("contactType")
      .default("ventas")
      .notNull(),
    branchName: varchar("branchName", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 80 }),
    email: varchar("email", { length: 320 }),
    address: text("address"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    supplierProjectIdx: index("sup_contact_supplier_project_idx").on(
      table.supplierId,
      table.projectId
    ),
    activeIdx: index("sup_contact_active_idx").on(table.isActive),
  })
);

export type SupplierContact = typeof supplierContacts.$inferSelect;
export type InsertSupplierContact = typeof supplierContacts.$inferInsert;

export const supplierDocumentTypes = pgTable(
  "supplierDocumentTypes",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    expirationMode: supplierDocumentExpirationModeEnum("expirationMode")
      .default("optional")
      .notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    codeIdx: uniqueIndex("sup_doc_type_code_idx").on(table.code),
    activeIdx: index("sup_doc_type_active_idx").on(table.isActive),
  })
);

export type SupplierDocumentType = typeof supplierDocumentTypes.$inferSelect;
export type InsertSupplierDocumentType =
  typeof supplierDocumentTypes.$inferInsert;

export const supplierDocuments = pgTable(
  "supplierDocuments",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplierId")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    documentTypeId: integer("documentTypeId")
      .notNull()
      .references(() => supplierDocumentTypes.id),
    attachmentId: integer("attachmentId")
      .notNull()
      .unique()
      .references(() => attachments.id, { onDelete: "cascade" }),
    documentDate: timestamp("documentDate").notNull(),
    expirationDate: timestamp("expirationDate"),
    description: text("description"),
    createdById: integer("createdById").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    supplierIdx: index("sup_doc_supplier_idx").on(table.supplierId),
    typeIdx: index("sup_doc_type_idx").on(table.documentTypeId),
    attachmentIdx: uniqueIndex("sup_doc_attachment_idx").on(table.attachmentId),
  })
);

export type SupplierDocument = typeof supplierDocuments.$inferSelect;
export type InsertSupplierDocument = typeof supplierDocuments.$inferInsert;
