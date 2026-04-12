import {
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
} from "drizzle-orm/pg-core";

// ============================================================
// ENUMS
// ============================================================
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const buildreqRoleEnum = pgEnum("buildreq_role", [
  "ingeniero_residente",
  "jefe_bodega_central",
  "administracion_central",
]);
export const projectStatusEnum = pgEnum("project_status", [
  "activo",
  "inactivo",
  "completado",
]);
export const recipientEnum = pgEnum("recipient", [
  "bodega_central",
  "administrador_proyecto",
  "solicitud_compra",
]);
export const requestStatusEnum = pgEnum("request_status", [
  "en_espera",
  "en_proceso",
  "cerrada",
]);
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
  "caja_chica",
]);
export const purchaseTypeEnum = pgEnum("purchase_type", ["local", "extranjera"]);
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// PROJECTS - Construction projects (up to 20 active)
// ============================================================
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 255 }),
  status: projectStatusEnum("status").default("activo").notNull(),
  /** SAP B1 project code for future integration */
  sapProjectCode: varchar("sapProjectCode", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ============================================================
// MATERIAL REQUESTS - Main request header
// ============================================================
export const materialRequests = pgTable(
  "materialRequests",
  {
    id: serial("id").primaryKey(),
    /** Auto-generated request number: REQ-YYYY-NNNN */
    requestNumber: varchar("requestNumber", { length: 20 }).notNull().unique(),
    projectId: integer("projectId").notNull(),
    requestedById: integer("requestedById").notNull(),
    /** Who receives: bodega_central, administrador_proyecto, or solicitud_compra */
    recipient: recipientEnum("recipient").notNull(),
    status: requestStatusEnum("status").default("en_espera").notNull(),
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
  (table) => ({
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
    /** SAP item code - filled by Jefe de Bodega when translating */
    sapItemCode: varchar("sapItemCode", { length: 50 }),
    /** SAP item description after translation */
    sapItemDescription: varchar("sapItemDescription", { length: 500 }),
    /** Which supply flow was assigned to this specific item */
    assignedFlow: flowTypeEnum("assignedFlow"),
    /** Quantity actually delivered/fulfilled */
    deliveredQuantity: decimal("deliveredQuantity", { precision: 12, scale: 2 }),
    status: requestItemStatusEnum("status").default("pendiente").notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    requestIdx: index("ri_request_idx").on(table.requestId),
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
    purchaseOrderNumber: varchar("purchaseOrderNumber", { length: 50 }),

    // --- SAP Integration fields ---
    sapDocumentType: sapDocumentTypeEnum("sapDocumentType"),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 50 }),
    sapSynced: boolean("sapSynced").default(false).notNull(),
    sapSyncedAt: timestamp("sapSyncedAt"),
    sapSyncError: text("sapSyncError"),

    status: supplyFlowStatusEnum("status").default("pendiente").notNull(),
    processedById: integer("processedById"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    requestIdx: index("sfr_request_idx").on(table.requestId),
    flowTypeIdx: index("sfr_flow_type_idx").on(table.flowType),
  })
);

export type SupplyFlowRecord = typeof supplyFlowRecords.$inferSelect;
export type InsertSupplyFlowRecord = typeof supplyFlowRecords.$inferInsert;

// ============================================================
// REVERSE LOGISTICS - Returns and defects
// ============================================================
export const reverseLogistics = pgTable(
  "reverseLogistics",
  {
    id: serial("id").primaryKey(),
    /** Auto-generated: DEV-YYYY-NNNN */
    returnNumber: varchar("returnNumber", { length: 20 }).notNull().unique(),
    returnType: returnTypeEnum("returnType").notNull(),
    reasonCategory: reasonCategoryEnum("reasonCategory").notNull(),
    /** MANDATORY justification text */
    justification: text("justification").notNull(),
    sourceProjectId: integer("sourceProjectId").notNull(),
    destinationProjectId: integer("destinationProjectId"),
    supplierName: varchar("supplierName", { length: 255 }),
    originalRequestId: integer("originalRequestId"),
    status: returnStatusEnum("status").default("pendiente").notNull(),
    sapDocumentType: varchar("sapDocumentType", { length: 50 }),
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 50 }),
    sapSynced: boolean("sapSynced").default(false).notNull(),
    createdById: integer("createdById").notNull(),
    processedById: integer("processedById"),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    sourceProjectIdx: index("rl_source_project_idx").on(table.sourceProjectId),
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
    itemName: varchar("itemName", { length: 500 }).notNull(),
    sapItemCode: varchar("sapItemCode", { length: 50 }),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    condition: itemConditionEnum("condition").default("nuevo").notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    reverseLogisticIdx: index("rli_reverse_logistic_idx").on(
      table.reverseLogisticId
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
  (table) => ({
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
  (table) => ({
    userIdx: index("notif_user_idx").on(table.userId),
    readIdx: index("notif_read_idx").on(table.userId, table.isRead),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

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
    warehouseLocation: varchar("warehouseLocation", { length: 100 }),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    sapCodeIdx: index("inv_sap_code_idx").on(table.sapItemCode),
    categoryIdx: index("inv_category_idx").on(table.category),
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
    sapDocumentNumber: varchar("sapDocumentNumber", { length: 50 }),
    requestPayload: text("requestPayload"),
    responsePayload: text("responsePayload"),
    status: sapSyncStatusEnum("status").default("pending").notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
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
  (table) => ({
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
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    codeIdx: index("sap_cat_code_idx").on(table.itemCode),
    descIdx: index("sap_cat_desc_idx").on(table.description),
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
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    codeIdx: index("sup_code_idx").on(table.supplierCode),
  })
);

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;
