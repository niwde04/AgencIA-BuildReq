import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { PURCHASE_ORDER_TAX_VALUES } from "@shared/purchase-orders";

const RECEIVABLE_PURCHASE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
]);

const UNIFIED_PURCHASE_REQUEST_STATUSES = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
]);

function canAccessPurchaseOrders(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "jefe_bodega_central"
  );
}

function assertProjectScopedAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
  },
  projectId: number
) {
  if (user.role === "admin") return;
  if (
    user.buildreqRole === "administrador_proyecto" &&
    user.assignedProjectId !== projectId
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a órdenes de compra de otro proyecto",
    });
  }
}

function assertPurchaseOrderEditable(status: string) {
  if (status === "anulada") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La orden de compra ya está anulada",
    });
  }
}

function assertPurchaseOrderMutable(status: string) {
  assertPurchaseOrderEditable(status);

  if (status === "recibida") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue recibida y solo está disponible en modo lectura",
    });
  }
}

function assertPurchaseOrderStructureEditable(status?: string | null) {
  assertPurchaseOrderEditable(status ?? "borrador");

  if (!status || status === "borrador") {
    return;
  }

  if (status === "recibida") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue recibida y solo está disponible en modo lectura",
    });
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      "La orden de compra ya fue emitida y no permite editar lineas ni proveedor",
  });
}

async function releaseDirectPurchaseRequestItems(
  materialRequestItemIds: Array<number | null | undefined>,
  userId: number,
  note: string
) {
  const affectedRequestIds = new Set<number>();

  for (const materialRequestItemId of materialRequestItemIds) {
    if (!materialRequestItemId) continue;

    const requestItem = await db.getRequestItemById(materialRequestItemId);
    if (!requestItem || requestItem.assignedFlow !== "compra_directa") continue;

    affectedRequestIds.add(requestItem.requestId);
    await db.updateRequestItem(requestItem.id, {
      assignedFlow: null,
      status: "pendiente",
    });

    const activeFlow = await db.getActiveSupplyFlowForRequestItem({
      requestId: requestItem.requestId,
      requestItemId: requestItem.id,
      flowType: "compra_directa",
    });

    if (activeFlow) {
      await db.updateSupplyFlowRecord(activeFlow.id, {
        status: "cancelado",
        notes: note,
      });
    }
  }

  for (const requestId of Array.from(affectedRequestIds)) {
    const requestItems = await db.getRequestItemsByRequestId(requestId);
    const someAssigned = requestItems.some(item => item.assignedFlow !== null);
    await db.updateMaterialRequestStatus(
      requestId,
      someAssigned ? "en_proceso" : "en_espera",
      userId
    );
  }
}

async function releaseDirectPurchaseOrderItems(params: {
  purchaseOrderNumber: string;
  userId: number;
  note: string;
  sapItemCode?: string | null;
}) {
  const flowItems = await db.listDirectPurchaseFlowItemsByOrder({
    purchaseOrderNumber: params.purchaseOrderNumber,
    sapItemCode: params.sapItemCode,
  });

  await releaseDirectPurchaseRequestItems(
    flowItems.map(entry => entry.item.id),
    params.userId,
    params.note
  );
}

export const purchaseOrdersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          classification: z.enum(["oc", "cd"]).optional(),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a órdenes de compra",
        });
      }

      const projectId =
        ctx.user.buildreqRole === "administrador_proyecto"
          ? (ctx.user.assignedProjectId ?? undefined)
          : input?.projectId;

      return db.listPurchaseOrders({
        ...input,
        projectId,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a órdenes de compra",
        });
      }

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      return detail;
    }),

  latestSupplierPrices: protectedProcedure
    .input(
      z.object({
        supplierId: z.number(),
        sapCodes: z.array(z.string().trim().min(1)).min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a órdenes de compra",
        });
      }

      return db.getLatestSupplierPurchasePrices({
        supplierId: input.supplierId,
        sapCodes: input.sapCodes,
        projectId:
          ctx.user.buildreqRole === "administrador_proyecto"
            ? (ctx.user.assignedProjectId ?? undefined)
            : undefined,
      });
    }),

  createFromPurchaseRequest: protectedProcedure
    .input(
      z.object({
        purchaseRequestId: z.number(),
        selectedItemIds: z.array(z.number()).min(1),
        classification: z.enum(["oc", "cd"]).default("oc"),
        supplierId: z.number().optional(),
        supplierEmail: z.string().email().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "administracion_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede convertir SC a OC",
        });
      }

      const detail = await db.getPurchaseRequestById(input.purchaseRequestId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      if (detail.purchaseRequest.status === "convertida") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La solicitud de compra ya fue convertida y solo está disponible en modo lectura",
        });
      }

      const selectedItems = detail.items.filter((item: any) =>
        input.selectedItemIds.includes(item.id)
      );
      if (selectedItems.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe seleccionar al menos un ítem para la OC",
        });
      }

      const directPurchaseRequestItemIds = selectedItems
        .map((item: any) => item.materialRequestItemId)
        .filter(
          (value: number | null | undefined): value is number =>
            typeof value === "number"
        );
      const directPurchaseFlowItems =
        directPurchaseRequestItemIds.length > 0
          ? await db.listDirectPurchaseFlowItemsByOrder({
              purchaseOrderNumber: detail.purchaseRequest.requestNumber,
              requestItemIds: directPurchaseRequestItemIds,
            })
          : [];
      const directPurchaseFlowByRequestItemId = new Map<number, any[]>();
      for (const linkedFlowItem of directPurchaseFlowItems) {
        const requestItemId = linkedFlowItem.item?.id;
        if (!requestItemId) continue;
        const current =
          directPurchaseFlowByRequestItemId.get(requestItemId) ?? [];
        current.push(linkedFlowItem);
        directPurchaseFlowByRequestItemId.set(requestItemId, current);
      }

      const selectedItemsByProject = new Map<number, any[]>();
      for (const item of selectedItems) {
        const sourceProjectId =
          item.sourceProject?.id ?? detail.purchaseRequest.projectId;
        const current = selectedItemsByProject.get(sourceProjectId) ?? [];
        current.push(item);
        selectedItemsByProject.set(sourceProjectId, current);
      }

      const createdOrders: Array<{
        projectId: number;
        purchaseOrderId: number;
        purchaseOrderNumber: string;
      }> = [];

      for (const [projectId, projectItems] of Array.from(
        selectedItemsByProject.entries()
      )) {
        const projectFlowItems = projectItems.flatMap((item: any) =>
          item.materialRequestItemId
            ? (directPurchaseFlowByRequestItemId.get(
                item.materialRequestItemId
              ) ?? [])
            : []
        );
        const inferredClassification =
          projectFlowItems.length > 0 ? "cd" : input.classification;
        const inferredSupplierId =
          input.supplierId ??
          projectFlowItems[0]?.flow?.supplierId ??
          undefined;

        const created = await db.createPurchaseOrder(
          {
            purchaseRequestId: detail.purchaseRequest.id,
            projectId,
            classification: inferredClassification,
            purchaseType: detail.purchaseRequest.purchaseType,
            supplierId: inferredSupplierId,
            supplierEmail: input.supplierEmail,
            status: "borrador",
            neededBy: detail.purchaseRequest.neededBy,
            sapDocumentNumber: detail.purchaseRequest.sapDocumentNumber,
            notes: input.notes ?? detail.purchaseRequest.notes ?? undefined,
            printedDocumentName: null,
            printedDocumentMimeType: null,
            printedDocumentContent: null,
            printedAt: null,
            emailStatus: "pendiente",
            emailedAt: null,
            emailError: null,
            createdById: ctx.user.id,
          },
          projectItems.map((item: any) => ({
            purchaseRequestItemId: item.id,
            materialRequestItemId: item.materialRequestItemId,
            originalSapItemCode: item.originalSapItemCode,
            currentSapItemCode: item.currentSapItemCode,
            itemName: item.itemName,
            quantity: item.quantity,
            receivedQuantity: item.receivedQuantity ?? "0.00",
            unit: item.unit,
            notes: item.notes,
          }))
        );

        createdOrders.push({
          projectId,
          purchaseOrderId: created.id,
          purchaseOrderNumber: created.orderNumber,
        });

        const updatedFlowIds = new Set<number>();
        for (const linkedFlowItem of projectFlowItems) {
          if (updatedFlowIds.has(linkedFlowItem.flow.id)) continue;
          updatedFlowIds.add(linkedFlowItem.flow.id);

          await db.updateSupplyFlowRecord(linkedFlowItem.flow.id, {
            purchaseOrderNumber: created.orderNumber,
            sapDocumentType: "orden_compra",
            status: "en_proceso",
            notes: input.notes ?? linkedFlowItem.flow.notes ?? undefined,
          });
        }
      }

      const nextStatus =
        selectedItems.length === detail.items.length
          ? "convertida"
          : "parcialmente_convertida";
      await db.updatePurchaseRequest(input.purchaseRequestId, {
        status: nextStatus,
      });

      if (createdOrders.length === 1) {
        return {
          success: true,
          purchaseOrderId: createdOrders[0].purchaseOrderId,
          purchaseOrderNumber: createdOrders[0].purchaseOrderNumber,
        };
      }

      return {
        success: true,
        purchaseOrders: createdOrders,
      };
    }),

  createUnifiedFromPurchaseRequests: protectedProcedure
    .input(
      z.object({
        purchaseRequestIds: z.array(z.number()).min(2),
        classification: z.enum(["oc", "cd"]).default("oc"),
        supplierId: z.number().optional(),
        supplierEmail: z.string().email().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "administracion_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede convertir SC a OC",
        });
      }

      const purchaseRequestIds = Array.from(new Set(input.purchaseRequestIds));
      if (purchaseRequestIds.length < 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione al menos dos solicitudes de compra",
        });
      }

      const details = await Promise.all(
        purchaseRequestIds.map((id) => db.getPurchaseRequestById(id))
      );

      const missingIndex = details.findIndex((detail) => !detail);
      if (missingIndex >= 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Una de las solicitudes de compra no fue encontrada",
        });
      }

      const purchaseRequests = details as Array<NonNullable<typeof details[number]>>;
      const blockedRequest = purchaseRequests.find(
        (detail) =>
          !UNIFIED_PURCHASE_REQUEST_STATUSES.has(
            detail.purchaseRequest.status
          )
      );
      if (blockedRequest) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La ${blockedRequest.purchaseRequest.requestNumber} no puede unificarse porque está ${blockedRequest.purchaseRequest.status}`,
        });
      }

      const purchaseTypes = new Set(
        purchaseRequests.map((detail) => detail.purchaseRequest.purchaseType)
      );
      if (purchaseTypes.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden unificar solicitudes con el mismo tipo de compra",
        });
      }

      const allItems = purchaseRequests.flatMap((detail) =>
        (detail.items ?? []).map((item: any) => ({
          detail,
          item,
          sourceProjectId:
            item.sourceProject?.id ?? detail.purchaseRequest.projectId,
        }))
      );
      if (allItems.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Las solicitudes seleccionadas no tienen ítems",
        });
      }

      const sourceProjectIds = new Set(
        allItems.map((entry) => entry.sourceProjectId)
      );
      if (sourceProjectIds.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Seleccione solicitudes del mismo proyecto para crear una OC unificada",
        });
      }

      const directPurchaseFlowByRequestItemId = new Map<number, any[]>();
      for (const detail of purchaseRequests) {
        const directPurchaseRequestItemIds = (detail.items ?? [])
          .map((item: any) => item.materialRequestItemId)
          .filter(
            (value: number | null | undefined): value is number =>
              typeof value === "number"
          );
        const directPurchaseFlowItems =
          directPurchaseRequestItemIds.length > 0
            ? await db.listDirectPurchaseFlowItemsByOrder({
                purchaseOrderNumber: detail.purchaseRequest.requestNumber,
                requestItemIds: directPurchaseRequestItemIds,
              })
            : [];

        for (const linkedFlowItem of directPurchaseFlowItems) {
          const requestItemId = linkedFlowItem.item?.id;
          if (!requestItemId) continue;
          const current =
            directPurchaseFlowByRequestItemId.get(requestItemId) ?? [];
          current.push(linkedFlowItem);
          directPurchaseFlowByRequestItemId.set(requestItemId, current);
        }
      }

      const flowItems = allItems.flatMap(({ item }) =>
        item.materialRequestItemId
          ? (directPurchaseFlowByRequestItemId.get(item.materialRequestItemId) ??
            [])
          : []
      );
      const earliestNeededBy = purchaseRequests
        .map((detail) => detail.purchaseRequest.neededBy)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
      const requestNumbers = purchaseRequests
        .map((detail) => detail.purchaseRequest.requestNumber)
        .join(", ");

      const created = await db.createPurchaseOrder(
        {
          purchaseRequestId: null,
          projectId: Array.from(sourceProjectIds)[0],
          classification: flowItems.length > 0 ? "cd" : input.classification,
          purchaseType: purchaseRequests[0].purchaseRequest.purchaseType,
          supplierId: input.supplierId ?? flowItems[0]?.flow?.supplierId ?? null,
          supplierEmail: input.supplierEmail,
          status: "borrador",
          neededBy: earliestNeededBy,
          sapDocumentNumber: null,
          notes:
            input.notes ??
            `Orden de compra unificada desde solicitudes: ${requestNumbers}`,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          emailStatus: "pendiente",
          emailedAt: null,
          emailError: null,
          createdById: ctx.user.id,
        },
        allItems.map(({ item }) => ({
          purchaseRequestItemId: item.id,
          materialRequestItemId: item.materialRequestItemId,
          originalSapItemCode: item.originalSapItemCode,
          currentSapItemCode: item.currentSapItemCode,
          itemName: item.itemName,
          quantity: item.quantity,
          receivedQuantity: item.receivedQuantity ?? "0.00",
          unit: item.unit,
          notes: item.notes,
        }))
      );

      const updatedFlowIds = new Set<number>();
      for (const linkedFlowItem of flowItems) {
        if (updatedFlowIds.has(linkedFlowItem.flow.id)) continue;
        updatedFlowIds.add(linkedFlowItem.flow.id);

        await db.updateSupplyFlowRecord(linkedFlowItem.flow.id, {
          purchaseOrderNumber: created.orderNumber,
          sapDocumentType: "orden_compra",
          status: "en_proceso",
          notes: input.notes ?? linkedFlowItem.flow.notes ?? undefined,
        });
      }

      for (const id of purchaseRequestIds) {
        await db.updatePurchaseRequest(id, {
          status: "convertida",
        });
      }

      return {
        success: true,
        purchaseOrderId: created.id,
        purchaseOrderNumber: created.orderNumber,
        purchaseRequestIds,
        unifiedPurchaseRequestCount: purchaseRequestIds.length,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        supplierId: z.number().optional(),
        supplierEmail: z.string().email().nullable().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar la OC",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(detail.purchaseOrder.status);

      return db.updatePurchaseOrder(input.id, {
        supplierId: input.supplierId,
        supplierEmail: input.supplierEmail,
        notes: input.notes,
      });
    }),

  replaceItem: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        currentSapItemCode: z.string().min(1),
        itemName: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para reemplazar ítems",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      return db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        currentSapItemCode: input.currentSapItemCode,
        itemName: input.itemName,
      });
    }),

  updateItemPricing: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        unitPrice: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) >= 0,
            {
              message: "El precio debe ser un numero valido",
            }
          ),
        taxCode: z.enum(PURCHASE_ORDER_TAX_VALUES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar montos de la OC",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      return db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        unitPrice: input.unitPrice,
        taxCode: input.taxCode,
      });
    }),

  updateItemLine: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        quantity: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) > 0,
            {
              message: "La cantidad debe ser un numero mayor que cero",
            }
          ),
        unitPrice: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) >= 0,
            {
              message: "El precio debe ser un numero valido",
            }
          ),
        taxCode: z.enum(PURCHASE_ORDER_TAX_VALUES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar lineas de la OC",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      const receivedQuantity = Number(itemDetail.item.receivedQuantity ?? 0);
      const nextQuantity = Number(input.quantity);
      if (nextQuantity < receivedQuantity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La cantidad no puede ser menor a lo ya recibido",
        });
      }

      return db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        taxCode: input.taxCode,
      });
    }),

  closeReceiptLine: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cerrar líneas de recepción",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }

      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderMutable(itemDetail.purchaseOrder.status);

      if (
        !RECEIVABLE_PURCHASE_ORDER_STATUSES.has(itemDetail.purchaseOrder.status)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden cerrar líneas de órdenes con recepciones pendientes",
        });
      }

      if (itemDetail.item.receiptClosed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La línea ya fue cerrada en recepción",
        });
      }

      const orderedQuantity = Number(itemDetail.item.quantity ?? 0);
      const receivedQuantity = Number(itemDetail.item.receivedQuantity ?? 0);

      if (!(receivedQuantity > 0 && receivedQuantity < orderedQuantity)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden cerrar líneas que estén parcialmente recibidas",
        });
      }

      await db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        receiptClosed: true,
        receiptClosedAt: new Date(),
        receiptClosedById: ctx.user.id,
        receiptCloseNote: input.note?.trim() || null,
      });

      const orderStatus = await db.syncPurchaseOrderReceiptStatus(
        itemDetail.item.purchaseOrderId
      );

      return {
        success: true,
        orderStatus,
      };
    }),

  movePendingToPurchaseRequest: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "No tiene permisos para reenviar saldos pendientes a solicitud de compra",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }

      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderMutable(itemDetail.purchaseOrder.status);

      if (
        !RECEIVABLE_PURCHASE_ORDER_STATUSES.has(itemDetail.purchaseOrder.status)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden reenviar saldos de órdenes con recepciones pendientes",
        });
      }

      if (itemDetail.item.receiptClosed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La línea ya fue cerrada en recepción",
        });
      }

      const orderedQuantity = Number(itemDetail.item.quantity ?? 0);
      const receivedQuantity = Number(itemDetail.item.receivedQuantity ?? 0);

      if (!(receivedQuantity > 0 && receivedQuantity < orderedQuantity)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden reenviar líneas que estén parcialmente recibidas",
        });
      }

      const pendingQuantity = (orderedQuantity - receivedQuantity).toFixed(2);
      const reusablePurchaseRequest =
        await db.getReusablePurchaseRequestBySourcePurchaseOrderId(
          itemDetail.purchaseOrder.id
        );

      const lineNote =
        input.note?.trim() ||
        `Saldo pendiente generado desde ${itemDetail.purchaseOrder.orderNumber}`;

      let purchaseRequestId = reusablePurchaseRequest?.id ?? null;
      let purchaseRequestNumber =
        reusablePurchaseRequest?.requestNumber ?? null;
      const reused = Boolean(reusablePurchaseRequest);

      if (reusablePurchaseRequest) {
        await db.addPurchaseRequestItems(reusablePurchaseRequest.id, [
          {
            materialRequestItemId:
              itemDetail.item.materialRequestItemId ?? null,
            sourcePurchaseOrderItemId: itemDetail.item.id,
            originalSapItemCode: itemDetail.item.originalSapItemCode,
            currentSapItemCode: itemDetail.item.currentSapItemCode,
            itemName: itemDetail.item.itemName,
            quantity: pendingQuantity,
            receivedQuantity: "0.00",
            unit: itemDetail.item.unit,
            notes: lineNote,
          },
        ]);
      } else {
        const createdPurchaseRequest = await db.createPurchaseRequest(
          {
            materialRequestId: null,
            sourcePurchaseOrderId: itemDetail.purchaseOrder.id,
            projectId: itemDetail.purchaseOrder.projectId,
            createdById: ctx.user.id,
            purchaseType: itemDetail.purchaseOrder.purchaseType ?? "local",
            status: "pendiente",
            neededBy: itemDetail.purchaseOrder.neededBy,
            sapDocumentNumber: null,
            notes:
              input.note?.trim() ||
              `Saldo pendiente generado desde ${itemDetail.purchaseOrder.orderNumber}`,
            rejectionReason: null,
            printedDocumentName: null,
            printedDocumentMimeType: null,
            printedDocumentContent: null,
            printedAt: null,
            quoteAttachmentId: null,
          },
          [
            {
              materialRequestItemId:
                itemDetail.item.materialRequestItemId ?? null,
              sourcePurchaseOrderItemId: itemDetail.item.id,
              originalSapItemCode: itemDetail.item.originalSapItemCode,
              currentSapItemCode: itemDetail.item.currentSapItemCode,
              itemName: itemDetail.item.itemName,
              quantity: pendingQuantity,
              receivedQuantity: "0.00",
              unit: itemDetail.item.unit,
              notes: lineNote,
            },
          ]
        );
        purchaseRequestId = createdPurchaseRequest.id;
        purchaseRequestNumber = createdPurchaseRequest.requestNumber;
      }

      await db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        receiptClosed: true,
        receiptClosedAt: new Date(),
        receiptClosedById: ctx.user.id,
        receiptCloseNote: lineNote,
      });

      const orderStatus = await db.syncPurchaseOrderReceiptStatus(
        itemDetail.item.purchaseOrderId
      );

      return {
        success: true,
        orderStatus,
        reused,
        purchaseRequestId,
        purchaseRequestNumber,
      };
    }),

  deleteItem: protectedProcedure
    .input(z.object({ purchaseOrderItemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para eliminar lineas de la OC",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      if (Number(itemDetail.item.receivedQuantity ?? 0) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede eliminar una linea que ya tiene recepciones registradas",
        });
      }

      const itemCount = await db.countPurchaseOrderItems(
        itemDetail.item.purchaseOrderId
      );
      await db.deletePurchaseOrderItem(input.purchaseOrderItemId);

      const lineSapCode =
        itemDetail.item.currentSapItemCode ??
        itemDetail.item.originalSapItemCode ??
        null;

      if (itemDetail.purchaseOrder.classification === "cd" && lineSapCode) {
        await releaseDirectPurchaseOrderItems({
          purchaseOrderNumber: itemDetail.purchaseOrder.orderNumber,
          userId: ctx.user.id,
          note: "Flujo cancelado por eliminar la linea de la orden de compra",
          sapItemCode: lineSapCode,
        });
      } else {
        await releaseDirectPurchaseRequestItems(
          [itemDetail.item.materialRequestItemId],
          ctx.user.id,
          "Flujo cancelado por eliminar la linea de la orden de compra"
        );
      }

      if (itemCount <= 1) {
        await db.updatePurchaseOrder(itemDetail.item.purchaseOrderId, {
          status: "anulada",
          emailStatus: "pendiente",
          emailedAt: null,
          emailError: "Orden anulada por eliminar su ultima linea",
        });
      }

      return { success: true, orderCancelled: itemCount <= 1 };
    }),

  cancelOrder: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cancelar la OC",
        });
      }

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(detail.purchaseOrder.status);

      const receivedItem = (detail.items ?? []).find(
        (item: any) => Number(item.receivedQuantity ?? 0) > 0
      );
      if (receivedItem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede cancelar una orden que ya tiene recepciones registradas",
        });
      }

      if (detail.purchaseOrder.classification === "cd") {
        await releaseDirectPurchaseOrderItems({
          purchaseOrderNumber: detail.purchaseOrder.orderNumber,
          userId: ctx.user.id,
          note: `Flujo cancelado por anular la orden ${detail.purchaseOrder.orderNumber}`,
        });
      } else {
        await releaseDirectPurchaseRequestItems(
          (detail.items ?? []).map((item: any) => item.materialRequestItemId),
          ctx.user.id,
          `Flujo cancelado por anular la orden ${detail.purchaseOrder.orderNumber}`
        );
      }

      await db.updatePurchaseOrder(input.id, {
        status: "anulada",
        emailStatus: "pendiente",
        emailedAt: null,
        emailError: "Orden anulada manualmente",
      });

      return { success: true };
    }),

  reopenDraft: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "administracion_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede reabrir una OC",
        });
      }

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);

      if (!["emitida", "enviada"].includes(detail.purchaseOrder.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se puede reabrir una OC emitida sin recepciones",
        });
      }

      const hasReceipts = (detail.items ?? []).some(
        (item: any) =>
          Number(item.receivedQuantity ?? 0) > 0 || item.receiptClosed
      );
      if (hasReceipts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede reabrir una OC que ya tiene recepciones registradas",
        });
      }

      await db.updatePurchaseOrder(input.id, {
        status: "borrador",
        emailStatus: "pendiente",
        emailedAt: null,
        emailError: null,
      });

      return { success: true };
    }),

  sendToSupplier: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para emitir la OC",
        });
      }

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(detail.purchaseOrder.status);

      if (
        detail.purchaseOrder.status === "anulada" ||
        (detail.items?.length ?? 0) === 0
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede emitir una orden anulada o sin lineas",
        });
      }

      const hasReceipts =
        detail.purchaseOrder.status === "recibida" ||
        detail.purchaseOrder.status === "parcialmente_recibida" ||
        (detail.items ?? []).some(
          (item: any) => Number(item.receivedQuantity ?? 0) > 0
        );

      if (hasReceipts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede emitir una orden que ya tiene recepciones registradas",
        });
      }

      if (
        detail.purchaseOrder.status &&
        detail.purchaseOrder.status !== "borrador"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La orden de compra ya fue emitida",
        });
      }

      await db.updatePurchaseOrder(input.id, {
        status: "emitida",
        emailStatus: "pendiente",
        emailedAt: null,
        emailError: null,
      });

      return { success: true };
    }),
});
