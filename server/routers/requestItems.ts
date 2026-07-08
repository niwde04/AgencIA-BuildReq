import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { canAccessProject } from "../projectAccess";

function canAssignFlows(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function canManageSapTranslation(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function canRejectApprovedItems(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "administracion_central"
  );
}

function canManageWarehouseDispatch(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

const BODEGUERO_PROJECT_FLOW_TYPES = new Set([
  "despacho_bodega",
  "compra_directa",
  "traslado_proyecto",
  "solicitud_compra",
]);

const PROJECT_ADMIN_FLOW_TYPES = new Set([
  "compra_directa",
  "solicitud_compra",
]);

const QUEUE_FLOW_TYPES = [
  "compra_directa",
  "despacho_bodega",
  "traslado_proyecto",
  "solicitud_compra",
] as const;

const SERVICE_FLOW_TYPES = new Set<(typeof QUEUE_FLOW_TYPES)[number]>([
  "compra_directa",
  "solicitud_compra",
]);

function canReturnQueuedFlowToRequisition(
  user: { role: string; buildreqRole?: string | null },
  flowType: (typeof QUEUE_FLOW_TYPES)[number]
) {
  if (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  ) {
    return true;
  }

  if (user.buildreqRole === "administrador_proyecto") {
    return PROJECT_ADMIN_FLOW_TYPES.has(flowType);
  }

  if (user.buildreqRole === "bodeguero_proyecto") {
    return BODEGUERO_PROJECT_FLOW_TYPES.has(flowType);
  }

  return false;
}

function canAccessRequest(
  user: {
    id: number;
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  request: { requestedById: number; projectId: number }
) {
  if (user.role === "admin") return true;
  if (user.buildreqRole === "ingeniero_residente") {
    return request.requestedById === user.id;
  }
  if (user.buildreqRole === "administrador_proyecto") {
    return canAccessProject(user, request.projectId);
  }
  if (user.buildreqRole === "bodeguero_proyecto") {
    return canAccessProject(user, request.projectId);
  }
  if (user.buildreqRole === "superintendente") {
    return canAccessProject(user, request.projectId);
  }
  return true;
}

function parseQuantityValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQuantityValue(value: unknown) {
  return parseQuantityValue(value).toFixed(2);
}

function getWarehouseDispatchPendingQuantity(item: {
  quantity?: string | number | null;
  dispatchedQuantity?: string | number | null;
}) {
  const requested = Math.max(parseQuantityValue(item.quantity), 0);
  const dispatched = Math.min(
    Math.max(parseQuantityValue(item.dispatchedQuantity), 0),
    requested
  );
  return Math.max(requested - dispatched, 0);
}

async function validateDispatchWarehouseForItem(params: {
  projectId: number;
  item: any;
  warehouseId?: number | null;
}) {
  if (!params.warehouseId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Seleccione una bodega para la salida de inventario",
    });
  }

  const projectWarehouses = await db.listWarehouses({
    projectId: params.projectId,
    isActive: true,
  });
  const selectedWarehouse = projectWarehouses.find(
    (warehouse: any) => Number(warehouse.id) === params.warehouseId
  );
  if (!selectedWarehouse) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La bodega seleccionada no está activa o no está asignada al proyecto",
    });
  }

  const pendingQuantity = getWarehouseDispatchPendingQuantity(params.item);
  const stockRows = await db.listVisibleWarehouseStockForItems({
    warehouseIds: [params.warehouseId],
    items: [
      {
        id: params.item.id,
        sapItemCode: params.item.sapItemCode,
        itemName: params.item.itemName,
      },
    ],
  });
  const availableQuantity = (stockRows[0]?.warehouses ?? [])
    .filter((entry: any) => Number(entry.warehouseId) === params.warehouseId)
    .reduce(
      (total: number, entry: any) => total + parseQuantityValue(entry.quantity),
      0
    );
  if (pendingQuantity > 0 && pendingQuantity - availableQuantity > 0.000001) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Stock insuficiente en la bodega seleccionada. Disponible: ${formatQuantityValue(
        availableQuantity
      )}, pendiente: ${formatQuantityValue(pendingQuantity)}`,
    });
  }

  return params.warehouseId;
}

async function assertItemApprovedForProcessing(requestItemId: number) {
  const item = await db.getRequestItemById(requestItemId);
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ítem no encontrado" });
  }

  const detail = await db.getMaterialRequestById(item.requestId);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "La requisición del ítem no existe",
    });
  }

  assertDetailItemApprovedForProcessing(detail, item);

  return { item, detail };
}

function assertDetailItemApprovedForProcessing(
  detail: NonNullable<Awaited<ReturnType<typeof db.getMaterialRequestById>>>,
  item: { approvalStatus?: string | null }
) {
  if (
    detail.request.requestType === "bienes" &&
    detail.request.approvalStatus === "pendiente"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La requisición todavía está pendiente de autorización del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto",
    });
  }

  if (item.approvalStatus === "rechazada") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este ítem fue rechazado y no se puede procesar",
    });
  }

  if (
    item.approvalStatus !== "aprobada" &&
    item.approvalStatus !== "no_requiere"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "El ítem todavía no ha sido autorizado para procesarse",
    });
  }
}

async function syncRequestStatusFromAssignments(requestId: number, userId: number) {
  try {
    await db.syncMaterialRequestFulfillmentStatus(requestId, userId);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "DB not available") {
      throw error;
    }

    const items = await db.getRequestItemsByRequestId(requestId);
    const someAssigned = items.some((item) => item.assignedFlow !== null);

    await db.updateMaterialRequestStatus(
      requestId,
      someAssigned ? "en_proceso" : "en_espera",
      userId
    );
  }
}

async function assertSapTranslationCanBeChanged(item: {
  id: number;
  requestId: number;
  deliveredQuantity?: string | null;
  dispatchedQuantity?: string | null;
}) {
  const existingFlows = (await db.getSupplyFlowByRequestId(item.requestId)).filter(
    (flow) => flow.requestItemId === item.id && flow.status !== "cancelado"
  );
  const hasMovement =
    Number(item.deliveredQuantity ?? 0) > 0 || Number(item.dispatchedQuantity ?? 0) > 0;

  if (existingFlows.length > 0 || hasMovement) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Este ítem ya tiene movimientos registrados y no se puede cambiar la traducción SAP",
    });
  }
}

async function assertQueuedFlowCanBeCleared(
  user: {
    id: number;
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  itemId: number,
  flowType: (typeof QUEUE_FLOW_TYPES)[number]
) {
  const { item, detail } = await assertItemApprovedForProcessing(itemId);
  if (!canAccessRequest(user, detail.request)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a esta solicitud",
    });
  }

  if (item.assignedFlow !== flowType) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "El ítem ya no está en el flujo seleccionado",
    });
  }

  if (
    detail.request.status === "borrador" ||
    detail.request.status === "flujo_completado" ||
    detail.request.status === "cerrada" ||
    detail.request.status === "cerrada_incompleta" ||
    detail.request.status === "anulada"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La requisición ya no permite cambios de flujo",
    });
  }

  const existingFlows = (await db.getSupplyFlowByRequestId(item.requestId)).filter(
    (flow) => flow.requestItemId === item.id && flow.status !== "cancelado"
  );
  const hasMovement =
    Number(item.deliveredQuantity ?? 0) > 0 ||
    Number(item.dispatchedQuantity ?? 0) > 0;

  if (existingFlows.length > 0 || hasMovement) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este ítem ya tiene movimientos registrados y no se puede quitar del flujo",
    });
  }

  return item;
}

export const requestItemsRouter = router({
  getByRequestId: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .query(async ({ ctx, input }) => {
      const detail = await db.getMaterialRequestById(input.requestId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Requisición no encontrada",
        });
      }
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      return db.getRequestItemsByRequestId(input.requestId);
    }),

  // Search SAP catalog for autocomplete (like the textbox in the image)
  searchSapCatalog: protectedProcedure
    .input(z.object({ search: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.searchSapCatalog(input.search);
    }),

  lookupSapItem: protectedProcedure
    .input(z.object({ sapItemCode: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      return db.lookupSapItemByCode(input.sapItemCode);
    }),

  // List all SAP catalog items
  listSapCatalog: protectedProcedure.query(async () => {
    return db.listSapCatalog();
  }),

  // Search suppliers
  searchSuppliers: protectedProcedure
    .input(z.object({ search: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.searchSuppliers(input.search);
    }),

  // List all suppliers
  listSuppliers: protectedProcedure.query(async () => {
    return db.listSuppliers();
  }),

  // Jefe de Bodega translates free-text item to SAP code via autocomplete
  translateToSap: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        sapItemCode: z.string().min(1),
        sapItemDescription: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageSapTranslation(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para traducir ítems a códigos SAP",
        });
      }
      const { item, detail } = await assertItemApprovedForProcessing(input.id);
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      await assertSapTranslationCanBeChanged(item);

      const sapItem = await db.lookupSapItemByCode(input.sapItemCode);
      const derivedRequestType =
        sapItem?.tipoArticulo === 2 ? "servicios" : sapItem ? "bienes" : null;

      const result = await db.updateRequestItem(input.id, {
        sapItemCode: input.sapItemCode,
        sapItemDescription: input.sapItemDescription,
      });

      if (
        derivedRequestType &&
        detail.request.requestType !== derivedRequestType
      ) {
        await db.updateMaterialRequest(detail.request.id, {
          requestType: derivedRequestType,
        });
      }

      return result;
    }),

  clearSapTranslation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canManageSapTranslation(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para modificar la traducción SAP",
        });
      }

      const { item, detail } = await assertItemApprovedForProcessing(input.id);
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      await assertSapTranslationCanBeChanged(item);

      const clearedFlow = Boolean(item.assignedFlow);

      await db.updateRequestItem(item.id, {
        sapItemCode: null,
        sapItemDescription: null,
        assignedFlow: null,
        warehouseId: null,
        status: "pendiente",
      });
      await syncRequestStatusFromAssignments(item.requestId, ctx.user.id);

      return {
        success: true,
        clearedFlow,
      };
    }),

  assignFlow: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        warehouseId: z.number().int().positive().nullable().optional(),
        flowType: z
          .enum([
            "compra_directa",
            "despacho_bodega",
            "traslado_proyecto",
            "solicitud_compra",
          ])
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAssignFlows(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para asignar flujos",
        });
      }

      const { item, detail } = await assertItemApprovedForProcessing(input.id);
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      if (
        ctx.user.buildreqRole === "bodeguero_proyecto" &&
        input.flowType &&
        !BODEGUERO_PROJECT_FLOW_TYPES.has(input.flowType)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "El Bodeguero de Proyecto solo puede enviar ítems a flujos de su proyecto",
        });
      }
      if (
        ctx.user.buildreqRole === "administrador_proyecto" &&
        input.flowType &&
        !PROJECT_ADMIN_FLOW_TYPES.has(input.flowType)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "El Administrador de Proyecto solo puede enviar ítems a Compra directa o Solicitud de compra",
        });
      }

      if (
        detail.request.status === "borrador" ||
        detail.request.status === "flujo_completado" ||
        detail.request.status === "cerrada" ||
        detail.request.status === "cerrada_incompleta" ||
        detail.request.status === "anulada"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La requisición ya no permite cambios de flujo",
        });
      }

      if (
        input.flowType &&
        detail.request.requestType === "servicios" &&
        !SERVICE_FLOW_TYPES.has(input.flowType)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Salida de bodega y solicitud de traslado no aplican para servicios",
        });
      }

      const existingFlows = (await db.getSupplyFlowByRequestId(item.requestId)).filter(
        (flow) => flow.requestItemId === item.id && flow.status !== "cancelado"
      );

      if (input.flowType === null) {
        const hasMovement =
          Number(item.deliveredQuantity ?? 0) > 0 || Number(item.dispatchedQuantity ?? 0) > 0;

        if (existingFlows.length > 0 || hasMovement) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Este ítem ya tiene movimientos registrados y no se puede quitar del flujo",
          });
        }

        await db.updateRequestItem(item.id, {
          assignedFlow: null,
          warehouseId: null,
          status: "pendiente",
        });
        await syncRequestStatusFromAssignments(item.requestId, ctx.user.id);
        return { success: true };
      }

      if (!item.sapItemCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe traducir el ítem a SAP antes de asignar un flujo",
        });
      }

      if (input.flowType === "solicitud_compra") {
        const existingPurchaseRequest = await db.getActivePurchaseRequestByMaterialRequestItemId(
          item.id
        );
        if (existingPurchaseRequest) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ya existe la solicitud ${existingPurchaseRequest.purchaseRequest.requestNumber} para este ítem`,
          });
        }
      }

      const activeSameFlow = existingFlows.some((flow) => flow.flowType === input.flowType);
      if (activeSameFlow) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este ítem ya tiene un flujo activo de este mismo tipo",
        });
      }

      const selectedWarehouseId =
        input.flowType === "despacho_bodega"
          ? await validateDispatchWarehouseForItem({
              projectId: detail.request.projectId,
              item,
              warehouseId: input.warehouseId,
            })
          : null;

      await db.updateRequestItem(item.id, {
        assignedFlow: input.flowType,
        warehouseId: selectedWarehouseId,
        status: "pendiente",
      });
      await syncRequestStatusFromAssignments(item.requestId, ctx.user.id);

      return { success: true };
    }),

  returnQueuedToRequisition: protectedProcedure
    .input(
      z.object({
        flowType: z.enum(QUEUE_FLOW_TYPES),
        itemIds: z.array(z.number()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canReturnQueuedFlowToRequisition(ctx.user, input.flowType)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para quitar ítems de este flujo",
        });
      }

      const uniqueItemIds = Array.from(new Set(input.itemIds));
      const itemsToClear = [];
      for (const itemId of uniqueItemIds) {
        itemsToClear.push(
          await assertQueuedFlowCanBeCleared(ctx.user, itemId, input.flowType)
        );
      }

      const requestIds = new Set<number>();
      for (const item of itemsToClear) {
        requestIds.add(item.requestId);
        await db.updateRequestItem(item.id, {
          assignedFlow: null,
          warehouseId: null,
          status: "pendiente",
        });
      }

      for (const requestId of Array.from(requestIds)) {
        await syncRequestStatusFromAssignments(requestId, ctx.user.id);
      }

      return {
        success: true,
        returnedItems: itemsToClear.length,
      };
    }),

  updateDelivered: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        deliveredQuantity: z.string(),
        status: z.enum(["pendiente", "parcial", "completo"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole === "ingeniero_residente" ||
        ctx.user.buildreqRole === "superintendente"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar entregas",
        });
      }
      if (ctx.user.buildreqRole === "bodeguero_proyecto") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar entregas",
        });
      }
      return db.updateRequestItem(input.id, {
        deliveredQuantity: input.deliveredQuantity,
        status: input.status,
      });
    }),

  recordWarehouseExit: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        requestItemId: z.number(),
        dispatchedQuantity: z.string(),
        warehouseId: z.number().int().positive().optional(),
        storageLocation: z.string().trim().max(255).nullable().optional(),
        note: z.string().optional(),
        receivedByName: z.string().trim().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseDispatch(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central, Administración Central o Bodeguero de Proyecto pueden registrar salida de bodega",
        });
      }
      if (!input.warehouseId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione almacén origen para la salida",
        });
      }

      const { item, detail } = await assertItemApprovedForProcessing(input.requestItemId);
      if (item.requestId !== input.requestId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El ítem no pertenece a la requisición indicada",
        });
      }
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      return db.recordWarehouseExit({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        quantity: input.dispatchedQuantity,
        warehouseId: input.warehouseId,
        ...(input.storageLocation
          ? { storageLocation: input.storageLocation }
          : {}),
        note: input.note,
        ...(input.receivedByName
          ? { receivedByName: input.receivedByName }
          : {}),
        processedById: ctx.user.id,
      });
    }),

  recordWarehouseExitBatch: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        destinationProjectId: z.number().int().positive().optional(),
        destinationWarehouseId: z.number().int().positive().optional(),
        items: z
          .array(
            z.object({
              requestItemId: z.number(),
              dispatchedQuantity: z.string(),
              sourceProjectId: z.number().int().positive().nullable().optional(),
              warehouseId: z.number().int().positive().optional(),
              storageLocation: z.string().trim().max(255).nullable().optional(),
              destinationProjectId: z.number().int().positive().optional(),
              destinationWarehouseId: z.number().int().positive().optional(),
              targetType: z
                .enum(["subproyecto", "activo_fijo"])
                .nullable()
                .optional(),
              subProjectId: z.number().int().positive().nullable().optional(),
              fixedAssetSapItemCode: z
                .string()
                .trim()
                .max(50)
                .nullable()
                .optional(),
              fixedAssetName: z
                .string()
                .trim()
                .max(500)
                .nullable()
                .optional(),
            })
          )
          .min(1),
        note: z.string().optional(),
        receivedByName: z.string().trim().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseDispatch(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central, Administración Central o Bodeguero de Proyecto pueden registrar salida de bodega",
        });
      }
      if (input.items.some((item) => !item.warehouseId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione almacén origen para todos los ítems de la salida",
        });
      }
      if (
        (input.destinationProjectId && !input.destinationWarehouseId) ||
        (!input.destinationProjectId && input.destinationWarehouseId)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione almacén destino y proyecto/bodega destino",
        });
      }
      if (
        input.destinationProjectId &&
        !canAccessProject(ctx.user, input.destinationProjectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a la bodega/proyecto destino seleccionada",
        });
      }

      const detail = await db.getMaterialRequestById(input.requestId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "La requisición no existe",
        });
      }
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      const detailItems: any[] = Array.isArray((detail as any).items)
        ? (detail as any).items
        : await Promise.all(
            input.items.map(entry => db.getRequestItemById(entry.requestItemId))
          );
      const detailItemsById = new Map<number, any>(
        detailItems
          .filter(Boolean)
          .map((item: any) => [item.id, item] as const)
      );

      for (const entry of input.items) {
        const item = detailItemsById.get(entry.requestItemId);
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Uno de los ítems ya no existe en la requisición",
          });
        }
        if (item.requestId !== input.requestId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uno de los ítems no pertenece a la requisición indicada",
          });
        }
        assertDetailItemApprovedForProcessing(detail, item);

        const sourceProjectId = entry.sourceProjectId ?? detail.request.projectId;
        if (sourceProjectId && !canAccessProject(ctx.user, sourceProjectId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No tiene acceso a la bodega/proyecto origen seleccionada",
          });
        }
        const destinationProjectId =
          entry.destinationProjectId ?? input.destinationProjectId;
        const destinationWarehouseId =
          entry.destinationWarehouseId ?? input.destinationWarehouseId;
        if (
          (destinationProjectId && !destinationWarehouseId) ||
          (!destinationProjectId && destinationWarehouseId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Seleccione almacén destino y bodega/proyecto destino para todos los ítems",
          });
        }
        if (
          destinationProjectId &&
          !canAccessProject(ctx.user, destinationProjectId)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No tiene acceso a la bodega/proyecto destino seleccionada",
          });
        }
      }

      return db.recordWarehouseExitBatch({
        requestId: input.requestId,
        destinationProjectId: input.destinationProjectId,
        destinationWarehouseId: input.destinationWarehouseId,
        items: input.items.map((item) => ({
          requestItemId: item.requestItemId,
          quantity: item.dispatchedQuantity,
          ...(item.sourceProjectId !== undefined
            ? { sourceProjectId: item.sourceProjectId }
            : {}),
          warehouseId: item.warehouseId!,
          ...(item.storageLocation
            ? { storageLocation: item.storageLocation }
            : {}),
          ...(item.destinationProjectId
            ? { destinationProjectId: item.destinationProjectId }
            : {}),
          ...(item.destinationWarehouseId
            ? { destinationWarehouseId: item.destinationWarehouseId }
            : {}),
          targetType: item.targetType,
          subProjectId: item.subProjectId,
          fixedAssetSapItemCode: item.fixedAssetSapItemCode,
          fixedAssetName: item.fixedAssetName,
        })),
        note: input.note,
        ...(input.receivedByName
          ? { receivedByName: input.receivedByName }
          : {}),
        processedById: ctx.user.id,
      });
    }),

  returnDispatchToRequisition: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseDispatch(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central, Administración Central o Bodeguero de Proyecto pueden devolver una salida a requisición",
        });
      }

      const { item, detail } = await assertItemApprovedForProcessing(input.id);
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      if (item.assignedFlow !== "despacho_bodega") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este ítem no está asignado a salida de bodega",
        });
      }

      return db.returnWarehouseDispatchItemToRequisition({
        requestItemId: input.id,
        processedById: ctx.user.id,
      });
    }),

  returnTransferToRequisition: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.buildreqRole !== "administracion_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central o Administración Central pueden devolver un traslado a requisición",
        });
      }

      const { item } = await assertItemApprovedForProcessing(input.id);
      if (item.assignedFlow !== "traslado_proyecto") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este ítem no está asignado a traslado",
        });
      }

      return db.returnTransferFlowItemToRequisition({
        requestItemId: input.id,
        processedById: ctx.user.id,
      });
    }),

  rejectPendingQuantity: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        reason: z
          .string()
          .trim()
          .min(5, "Escriba un motivo de rechazo de al menos 5 caracteres"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.buildreqRole !== "administracion_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central o Administración Central pueden rechazar saldos pendientes",
        });
      }

      const { item } = await assertItemApprovedForProcessing(input.id);
      const requestedQuantity = Number(item.quantity ?? 0);
      const processedQuantity = Math.max(
        Number(item.deliveredQuantity ?? 0),
        Number(item.dispatchedQuantity ?? 0)
      );
      if (!(requestedQuantity > 0 && processedQuantity < requestedQuantity)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este ítem no tiene saldo pendiente para rechazar",
        });
      }

      return db.rejectRequestItemPendingQuantity({
        requestItemId: input.id,
        rejectedById: ctx.user.id,
        rejectionReason: input.reason,
      });
    }),

  rejectApproved: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        reason: z
          .string()
          .trim()
          .min(5, "Escriba un motivo de rechazo de al menos 5 caracteres"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canRejectApprovedItems(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Administrador del Proyecto o Administración Central pueden rechazar ítems aprobados",
        });
      }

      const { item, detail } = await assertItemApprovedForProcessing(input.id);
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      if (detail.request.requestType !== "bienes") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El rechazo por ítem aplica solo a requisiciones de bienes",
        });
      }
      if (
        detail.request.status === "borrador" ||
        detail.request.status === "cerrada" ||
        detail.request.status === "cerrada_incompleta" ||
        detail.request.status === "anulada"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La requisición no permite rechazar ítems aprobados",
        });
      }

      const activeFlows = (await db.getSupplyFlowByRequestId(item.requestId)).filter(
        (flow) => flow.requestItemId === item.id && flow.status !== "cancelado"
      );
      const hasMovement =
        Number(item.deliveredQuantity ?? 0) > 0 || Number(item.dispatchedQuantity ?? 0) > 0;
      if (activeFlows.length > 0 || Boolean(item.assignedFlow) || hasMovement) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden rechazar ítems aprobados sin flujo activo ni movimientos",
        });
      }

      return db.rejectApprovedRequestItem({
        requestItemId: input.id,
        rejectedById: ctx.user.id,
        rejectionReason: input.reason,
      });
    }),
});
