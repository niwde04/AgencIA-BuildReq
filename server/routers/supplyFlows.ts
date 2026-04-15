import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

function canManageSupply(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

async function getRequestAndItem(requestId: number, requestItemId: number) {
  const detail = await db.getMaterialRequestById(requestId);
  const item = detail?.items.find((entry: any) => entry.id === requestItemId);
  if (!detail || !item) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "La requisición o el ítem no existen",
    });
  }

  return { detail, item };
}

function assertItemApprovedForProcessing(detail: any, item: any) {
  if (
    detail.request.requestType === "bienes" &&
    detail.request.approvalStatus === "pendiente"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La requisición todavía está pendiente de autorización del Administrador del Proyecto o Administración Central",
    });
  }

  if (item.approvalStatus === "rechazada") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El ítem ${item.itemName} fue rechazado y no se puede procesar`,
    });
  }

  if (
    item.approvalStatus !== "aprobada" &&
    item.approvalStatus !== "no_requiere"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El ítem ${item.itemName} todavía no ha sido autorizado para procesarse`,
    });
  }
}

export const supplyFlowsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          flowType: z.string().optional(),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => db.listSupplyFlowRecords(input ?? undefined)),

  getByRequestId: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .query(async ({ input }) => db.getSupplyFlowByRequestId(input.requestId)),

  availableFlows: protectedProcedure.query(({ ctx }) => {
    if (!canManageSupply(ctx.user)) return [];

    if (
      ctx.user.role === "admin" ||
      ctx.user.buildreqRole === "jefe_bodega_central"
    ) {
      return ["compra_directa", "traslado_proyecto", "solicitud_compra"];
    }

    if (ctx.user.buildreqRole === "administracion_central") {
      return ["compra_directa", "solicitud_compra"];
    }

    return [];
  }),

  sapMapping: protectedProcedure.query(() => ({
    despacho_bodega: {
      sapDocument: "Salida de Inventario",
      sapModule: "Inventario",
      description:
        "Flujo legado. La salida de bodega ahora se registra como operación de despacho.",
      legacy: true,
    },
    solicitud_compra: {
      sapDocument: "Solicitud de Compra",
      sapModule: "Compras",
      description:
        "Genera una Solicitud de Compra en SAP que luego puede convertirse en Orden de Compra",
    },
    traslado_proyecto: {
      sapDocument: "Solicitud de Transferencia",
      sapModule: "Inventario",
      description:
        "Genera una Solicitud de Traslado con confirmación posterior y Guía de Remisión",
    },
    compra_directa: {
      sapDocument: "Orden de Compra → Entrada de Mercancías",
      sapModule: "Compras",
      description:
        "Genera una Compra Directa clasificada como CD y luego admite recepciones parciales",
      twoStepFlow: true,
      step1: "Orden de Compra",
      step2: "Recepción",
    },
  })),

  createDirectPurchase: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        requestItemId: z.number(),
        paymentMethod: z.enum(["linea_credito", "caja_chica"]),
        supplierId: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageSupply(ctx.user) || ctx.user.buildreqRole === "ingeniero_residente") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar compras directas",
        });
      }

      const { detail, item } = await getRequestAndItem(input.requestId, input.requestItemId);
      assertItemApprovedForProcessing(detail, item);

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "compra_directa",
        status: "pendiente",
      });

      const purchaseOrder = await db.createPurchaseOrder(
        {
          purchaseRequestId: null,
          projectId: detail.request.projectId,
          classification: "cd",
          purchaseType: "local",
          supplierId: input.supplierId,
          supplierEmail: null,
          status: "emitida",
          neededBy: detail.request.neededBy,
          sapDocumentNumber: null,
          notes: input.notes ?? `Compra directa por ${input.paymentMethod}`,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          emailStatus: "pendiente",
          emailedAt: null,
          emailError: null,
          createdById: ctx.user.id,
        },
        [
          {
            purchaseRequestItemId: null,
            materialRequestItemId: item.id,
            originalSapItemCode: item.sapItemCode,
            currentSapItemCode: item.sapItemCode,
            itemName: item.sapItemDescription || item.itemName,
            quantity: item.quantity,
            receivedQuantity: "0.00",
            unit: item.unit,
            notes: input.notes,
          },
        ]
      );

      const result = await db.createSupplyFlowRecord({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        flowType: "compra_directa",
        paymentMethod: input.paymentMethod,
        supplierId: input.supplierId,
        purchaseOrderNumber: purchaseOrder.orderNumber,
        sapDocumentType: "orden_compra",
        processedById: ctx.user.id,
        notes: input.notes,
        status: "en_proceso",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      return {
        ...result,
        purchaseOrderId: purchaseOrder.id,
        purchaseOrderNumber: purchaseOrder.orderNumber,
      };
    }),

  createDirectPurchaseBatch: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        items: z
          .array(
            z.object({
              requestItemId: z.number(),
              quantity: z
                .string()
                .trim()
                .min(1)
                .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
                  message: "La cantidad debe ser un numero mayor que cero",
                }),
            })
          )
          .min(1),
        supplierId: z.number(),
        paymentMethod: z.enum(["linea_credito", "caja_chica"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageSupply(ctx.user) || ctx.user.buildreqRole === "ingeniero_residente") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar compras directas",
        });
      }

      const detail = await db.getMaterialRequestById(input.requestId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "La requisición no existe",
        });
      }
      if (
        detail.request.requestType === "bienes" &&
        detail.request.approvalStatus === "pendiente"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La requisición todavía está pendiente de autorización del Administrador del Proyecto o Administración Central",
        });
      }

      const uniqueItems = Array.from(
        new Map(input.items.map((item) => [item.requestItemId, item])).values()
      );
      const requestItemsById = new Map(
        detail.items.map((item: any) => [item.id, item] as const)
      );

      const preparedItems = [];
      for (const entry of uniqueItems) {
        const item = requestItemsById.get(entry.requestItemId);
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Uno de los ítems ya no existe en la requisición",
          });
        }
        assertItemApprovedForProcessing(detail, item);

        const existingDirectPurchaseFlow = await db.getActiveSupplyFlowForRequestItem({
          requestId: input.requestId,
          requestItemId: entry.requestItemId,
          flowType: "compra_directa",
        });
        if (existingDirectPurchaseFlow) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El ítem ${item.itemName} ya tiene una compra directa activa`,
          });
        }

        const requestedQuantity = Number(item.quantity ?? 0);
        const selectedQuantity = Number(entry.quantity);
        if (selectedQuantity > requestedQuantity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La cantidad de ${item.itemName} no puede exceder ${item.quantity}`,
          });
        }

        if (selectedQuantity < requestedQuantity) {
          const remainingQuantity = requestedQuantity - selectedQuantity;

          await db.updateRequestItem(item.id, {
            quantity: remainingQuantity.toFixed(2),
          });

          const createdItem = await db.createRequestItem({
            requestId: detail.request.id,
            itemName: item.itemName,
            quantity: entry.quantity,
            unit: item.unit,
            sapItemCode: item.sapItemCode,
            sapItemDescription: item.sapItemDescription,
            assignedFlow: "compra_directa",
            deliveredQuantity: "0.00",
            dispatchedQuantity: "0.00",
            committedQuantity: item.committedQuantity ?? "0.00",
            projectStock: item.projectStock ?? "0.00",
            sapStock: item.sapStock ?? "0.00",
            warehouseExitNote: null,
            approvalStatus: item.approvalStatus,
            approvedById: item.approvedById,
            approvedAt: item.approvedAt,
            rejectionReason: item.rejectionReason,
            status: "pendiente",
            notes: item.notes,
          });

          preparedItems.push({
            sourceItemId: item.id,
            processedItemId: createdItem.id,
            item: {
              ...item,
              id: createdItem.id,
              quantity: entry.quantity,
              assignedFlow: "compra_directa",
              deliveredQuantity: "0.00",
              dispatchedQuantity: "0.00",
            },
          });
          continue;
        }

        await db.updateRequestItem(item.id, {
          assignedFlow: "compra_directa",
          status: "pendiente",
        });

        preparedItems.push({
          sourceItemId: item.id,
          processedItemId: item.id,
          item: {
            ...item,
            quantity: entry.quantity,
            assignedFlow: "compra_directa",
          },
        });
      }

      const purchaseOrder = await db.createPurchaseOrder(
        {
          purchaseRequestId: null,
          projectId: detail.request.projectId,
          classification: "cd",
          purchaseType: "local",
          supplierId: input.supplierId,
          supplierEmail: null,
          status: "emitida",
          neededBy: detail.request.neededBy,
          sapDocumentNumber: null,
          notes: input.notes ?? `Compra directa por ${input.paymentMethod}`,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          emailStatus: "pendiente",
          emailedAt: null,
          emailError: null,
          createdById: ctx.user.id,
        },
        preparedItems.map((entry: any) => ({
          purchaseRequestItemId: null,
          materialRequestItemId: entry.processedItemId,
          originalSapItemCode: entry.item.sapItemCode,
          currentSapItemCode: entry.item.sapItemCode,
          itemName: entry.item.sapItemDescription || entry.item.itemName,
          quantity: entry.item.quantity,
          receivedQuantity: "0.00",
          unit: entry.item.unit,
          notes: input.notes,
        }))
      );

      for (const entry of preparedItems) {
        await db.createSupplyFlowRecord({
          requestId: input.requestId,
          requestItemId: entry.processedItemId,
          flowType: "compra_directa",
          paymentMethod: input.paymentMethod,
          supplierId: input.supplierId,
          purchaseOrderNumber: purchaseOrder.orderNumber,
          sapDocumentType: "orden_compra",
          processedById: ctx.user.id,
          notes: input.notes,
          status: "en_proceso",
        });
      }

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      return {
        success: true,
        purchaseOrderId: purchaseOrder.id,
        purchaseOrderNumber: purchaseOrder.orderNumber,
        processedItems: preparedItems.length,
      };
    }),

  confirmGoodsReceipt: protectedProcedure
    .input(
      z.object({
        flowId: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageSupply(ctx.user) || ctx.user.buildreqRole === "ingeniero_residente") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para confirmar recepción de mercancía",
        });
      }

      await db.updateSupplyFlowRecord(input.flowId, {
        sapDocumentType: "entrada_mercancia",
        status: "completado",
        notes: input.notes,
      });

      return { success: true };
    }),

  createWarehouseDispatch: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        requestItemId: z.number(),
        sourceWarehouse: z.string().min(1),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.buildreqRole !== "jefe_bodega_central" && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Jefe de Bodega Central puede despachar materiales",
        });
      }

      const { detail, item } = await getRequestAndItem(input.requestId, input.requestItemId);
      assertItemApprovedForProcessing(detail, item);
      await db.recordWarehouseExit({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        quantity: item.quantity,
        note: input.notes ?? `Salida registrada desde ${input.sourceWarehouse}`,
        processedById: ctx.user.id,
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);
      return { success: true };
    }),

  createProjectTransfer: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        requestItemId: z.number(),
        sourceProjectId: z.number(),
        destinationProjectId: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.buildreqRole !== "jefe_bodega_central" && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Jefe de Bodega Central puede gestionar traslados",
        });
      }

      const { detail, item } = await getRequestAndItem(input.requestId, input.requestItemId);
      assertItemApprovedForProcessing(detail, item);
      if (input.sourceProjectId === detail.request.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El proyecto origen debe ser distinto al proyecto solicitante",
        });
      }

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "traslado_proyecto",
        status: "pendiente",
      });

      const transferRequest = await db.createTransferRequest(
        {
          materialRequestId: input.requestId,
          projectId: input.sourceProjectId,
          destinationType: "proyecto",
          destinationProjectId: detail.request.projectId,
          createdById: ctx.user.id,
          status: "pendiente",
          neededBy: detail.request.neededBy,
          notes: input.notes,
          rejectionReason: null,
        },
        [
          {
            materialRequestItemId: item.id,
            itemName: item.sapItemDescription || item.itemName,
            sapItemCode: item.sapItemCode,
            quantity: item.quantity,
            receivedQuantity: "0.00",
            unit: item.unit,
            notes: input.notes,
          },
        ]
      );

      const result = await db.createSupplyFlowRecord({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        flowType: "traslado_proyecto",
        sourceProjectId: input.sourceProjectId,
        destinationProjectId: input.destinationProjectId,
        sapDocumentType: "transferencia_inventario",
        processedById: ctx.user.id,
        notes: input.notes,
        status: "pendiente",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      return {
        ...result,
        transferRequestId: transferRequest.id,
        transferRequestNumber: transferRequest.requestNumber,
      };
    }),

  createPurchaseRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        requestItemId: z.number(),
        purchaseType: z.enum(["local", "extranjera"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageSupply(ctx.user) || ctx.user.buildreqRole === "ingeniero_residente") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de compra",
        });
      }

      const { detail, item } = await getRequestAndItem(input.requestId, input.requestItemId);
      assertItemApprovedForProcessing(detail, item);
      const [existingPurchaseRequest, existingPurchaseRequestFlow] = await Promise.all([
        db.getActivePurchaseRequestByMaterialRequestItemId(item.id),
        db.getActiveSupplyFlowForRequestItem({
          requestId: input.requestId,
          requestItemId: input.requestItemId,
          flowType: "solicitud_compra",
        }),
      ]);

      if (existingPurchaseRequest || existingPurchaseRequestFlow) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: existingPurchaseRequest
            ? `Ya existe la solicitud ${existingPurchaseRequest.purchaseRequest.requestNumber} para este ítem`
            : "Ya existe una solicitud de compra para este ítem",
        });
      }

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "solicitud_compra",
        status: "pendiente",
      });

      const purchaseRequest = await db.createPurchaseRequest(
        {
          materialRequestId: input.requestId,
          projectId: detail.request.projectId,
          createdById: ctx.user.id,
          purchaseType: input.purchaseType,
          status: "pendiente",
          neededBy: detail.request.neededBy,
          sapDocumentNumber: null,
          notes: input.notes,
          rejectionReason: null,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          quoteAttachmentId: null,
        },
        [
          {
            materialRequestItemId: item.id,
            originalSapItemCode: item.sapItemCode,
            currentSapItemCode: item.sapItemCode,
            itemName: item.sapItemDescription || item.itemName,
            quantity: item.quantity,
            receivedQuantity: "0.00",
            unit: item.unit,
            notes: input.notes,
          },
        ]
      );

      const result = await db.createSupplyFlowRecord({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        flowType: "solicitud_compra",
        purchaseType: input.purchaseType,
        sapDocumentType: "solicitud_compra",
        processedById: ctx.user.id,
        notes: input.notes,
        status: "pendiente",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      const adminUsers = await db.getUsersByBuildreqRole("administracion_central");
      for (const user of adminUsers) {
        await db.createNotification({
          userId: user.id,
          title: "Nueva solicitud de compra",
          message: `Se generó la ${purchaseRequest.requestNumber} (${input.purchaseType}) para la requisición ${detail.request.requestNumber}.`,
          type: "solicitud_compra",
          relatedEntityType: "purchase_request",
          relatedEntityId: purchaseRequest.id,
        });
      }

      return {
        ...result,
        purchaseRequestId: purchaseRequest.id,
        purchaseRequestNumber: purchaseRequest.requestNumber,
      };
    }),

  convertToPurchaseOrder: protectedProcedure
    .input(
      z.object({
        flowId: z.number().optional(),
        purchaseRequestId: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "administracion_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede convertir a Orden de Compra",
        });
      }

      if (!input.flowId && !input.purchaseRequestId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe indicar una solicitud de compra o flujo origen",
        });
      }

      if (input.purchaseRequestId) {
        const detail = await db.getPurchaseRequestById(input.purchaseRequestId);
        if (!detail) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Solicitud de compra no encontrada",
          });
        }

        const order = await db.createPurchaseOrder(
          {
            purchaseRequestId: detail.purchaseRequest.id,
            projectId: detail.purchaseRequest.projectId,
            classification: "oc",
            purchaseType: detail.purchaseRequest.purchaseType,
            supplierId: null,
            supplierEmail: null,
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
          detail.items.map((item: any) => ({
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

        await db.updatePurchaseRequest(detail.purchaseRequest.id, {
          status: "convertida",
        });

        return {
          success: true,
          purchaseOrderId: order.id,
          purchaseOrderNumber: order.orderNumber,
        };
      }

      const purchaseOrderNumber = await db.generatePurchaseOrderNumber();
      const result = await db.updateSupplyFlowRecord(input.flowId!, {
        purchaseOrderNumber,
        sapDocumentType: "orden_compra",
        status: "en_proceso",
        notes: input.notes,
      });

      return {
        ...result,
        purchaseOrderNumber,
      };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pendiente", "en_proceso", "completado", "cancelado"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) =>
      db.updateSupplyFlowRecord(input.id, {
        status: input.status,
        notes: input.notes,
      })
    ),
});

async function checkAndUpdateRequestStatus(requestId: number, userId: number) {
  const items = await db.getRequestItemsByRequestId(requestId);
  const someAssigned = items.some((item) => item.assignedFlow !== null);

  if (someAssigned) {
    await db.updateMaterialRequestStatus(requestId, "en_proceso", userId);
  }
}
