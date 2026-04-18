import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { PURCHASE_ORDER_TAX_VALUES } from "@shared/purchase-orders";

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
  user: { role: string; buildreqRole?: string | null; assignedProjectId?: number | null },
  projectId: number
) {
  if (user.role === "admin") return;
  if (user.buildreqRole === "administrador_proyecto" && user.assignedProjectId !== projectId) {
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
    const someAssigned = requestItems.some((item) => item.assignedFlow !== null);
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
    flowItems.map((entry) => entry.item.id),
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
          ? ctx.user.assignedProjectId ?? undefined
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
            ? ctx.user.assignedProjectId ?? undefined
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

      const selectedItems = detail.items.filter((item: any) =>
        input.selectedItemIds.includes(item.id)
      );
      if (selectedItems.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe seleccionar al menos un ítem para la OC",
        });
      }

      const created = await db.createPurchaseOrder(
        {
          purchaseRequestId: detail.purchaseRequest.id,
          projectId: detail.purchaseRequest.projectId,
          classification: input.classification,
          purchaseType: detail.purchaseRequest.purchaseType,
          supplierId: input.supplierId,
          supplierEmail: input.supplierEmail,
          status: "emitida",
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
        selectedItems.map((item: any) => ({
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

      const nextStatus =
        selectedItems.length === detail.items.length
          ? "convertida"
          : "parcialmente_convertida";
      await db.updatePurchaseRequest(input.purchaseRequestId, {
        status: nextStatus,
      });

      return {
        success: true,
        purchaseOrderId: created.id,
        purchaseOrderNumber: created.orderNumber,
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
      assertPurchaseOrderEditable(detail.purchaseOrder.status);

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

      const itemDetail = await db.getPurchaseOrderItemById(input.purchaseOrderItemId);
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(itemDetail.purchaseOrder.status);

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
          .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
            message: "El precio debe ser un numero valido",
          }),
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

      const itemDetail = await db.getPurchaseOrderItemById(input.purchaseOrderItemId);
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(itemDetail.purchaseOrder.status);

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
          .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
            message: "La cantidad debe ser un numero mayor que cero",
          }),
        unitPrice: z
          .string()
          .trim()
          .min(1)
          .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
            message: "El precio debe ser un numero valido",
          }),
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

      const itemDetail = await db.getPurchaseOrderItemById(input.purchaseOrderItemId);
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(itemDetail.purchaseOrder.status);

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

  deleteItem: protectedProcedure
    .input(z.object({ purchaseOrderItemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para eliminar lineas de la OC",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(input.purchaseOrderItemId);
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(itemDetail.purchaseOrder.status);

      if (Number(itemDetail.item.receivedQuantity ?? 0) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede eliminar una linea que ya tiene recepciones registradas",
        });
      }

      const itemCount = await db.countPurchaseOrderItems(itemDetail.item.purchaseOrderId);
      await db.deletePurchaseOrderItem(input.purchaseOrderItemId);

      const lineSapCode =
        itemDetail.item.currentSapItemCode ?? itemDetail.item.originalSapItemCode ?? null;

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
          message: "No se puede cancelar una orden que ya tiene recepciones registradas",
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

      if (detail.purchaseOrder.status === "anulada" || (detail.items?.length ?? 0) === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede emitir una orden anulada o sin lineas",
        });
      }

      const hasReceipts =
        detail.purchaseOrder.status === "recibida" ||
        detail.purchaseOrder.status === "parcialmente_recibida" ||
        (detail.items ?? []).some((item: any) => Number(item.receivedQuantity ?? 0) > 0);

      if (hasReceipts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede emitir una orden que ya tiene recepciones registradas",
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
