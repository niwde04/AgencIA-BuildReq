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

function canManageWarehouseOrTransfers(user: {
  role: string;
  buildreqRole?: string | null;
}) {
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

function resolveEarliestNeededBy(
  current: Date | string | null | undefined,
  candidate: Date | string | null | undefined
) {
  if (!candidate) {
    return current ? new Date(current) : null;
  }
  if (!current) {
    return new Date(candidate);
  }

  const currentDate = new Date(current);
  const candidateDate = new Date(candidate);

  return candidateDate.getTime() < currentDate.getTime() ? candidateDate : currentDate;
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

  pendingQueue: protectedProcedure
    .input(
      z
        .object({
          flowType: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => db.listPendingFlowQueueItems(input ?? undefined)),

  getByRequestId: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .query(async ({ input }) => db.getSupplyFlowByRequestId(input.requestId)),

  availableFlows: protectedProcedure.query(({ ctx }) => {
    if (!canManageSupply(ctx.user)) return [];

    if (canManageWarehouseOrTransfers(ctx.user)) {
      return ["compra_directa", "traslado_proyecto", "solicitud_compra"];
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
      sapDocument: "Solicitud de Compra → Orden de Compra",
      sapModule: "Compras",
      description:
        "Genera una SC desde compra directa y luego la convierte en una OC clasificada como CD",
      twoStepFlow: true,
      step1: "Solicitud de Compra",
      step2: "Orden de Compra",
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
        requestId: z.number().optional(),
        items: z
          .array(
            z.object({
              requestId: z.number().optional(),
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

      const uniqueItems = Array.from(
        new Map(
          input.items.map((item) => {
            const resolvedRequestId = item.requestId ?? input.requestId;
            if (!resolvedRequestId) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Cada ítem debe indicar a qué requisición pertenece",
              });
            }

            return [
              `${resolvedRequestId}:${item.requestItemId}`,
              {
                ...item,
                requestId: resolvedRequestId,
              },
            ] as const;
          })
        ).values()
      );

      const requestIds = Array.from(
        new Set(uniqueItems.map((item) => item.requestId))
      );
      const requestDetailsById = new Map<number, any>();
      const requestItemsByRequestId = new Map<number, Map<number, any>>();

      for (const requestId of requestIds) {
        const detail = await db.getMaterialRequestById(requestId);
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

        requestDetailsById.set(requestId, detail);
        requestItemsByRequestId.set(
          requestId,
          new Map(detail.items.map((item: any) => [item.id, item] as const))
        );
      }

      const preparedItems: Array<{
        requestId: number;
        projectId: number;
        neededBy: Date | null;
        sourceItemId: number;
        processedItemId: number;
        item: any;
      }> = [];
      for (const entry of uniqueItems) {
        const detail = requestDetailsById.get(entry.requestId);
        const requestItemsById = requestItemsByRequestId.get(entry.requestId);
        const item = requestItemsById?.get(entry.requestItemId);
        if (!detail || !item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Uno de los ítems ya no existe en la requisición",
          });
        }
        assertItemApprovedForProcessing(detail, item);

        const existingDirectPurchaseFlow = await db.getActiveSupplyFlowForRequestItem({
          requestId: entry.requestId,
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
            requestId: entry.requestId,
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
            requestId: entry.requestId,
            projectId: detail.request.projectId,
            neededBy: detail.request.neededBy ? new Date(detail.request.neededBy) : null,
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
          requestId: entry.requestId,
          projectId: detail.request.projectId,
          neededBy: detail.request.neededBy ? new Date(detail.request.neededBy) : null,
          sourceItemId: item.id,
          processedItemId: item.id,
          item: {
            ...item,
            quantity: entry.quantity,
            assignedFlow: "compra_directa",
          },
        });
      }

      const aggregatedLines = new Map<string, any>();
      let earliestNeededBy: Date | null = null;

      for (const entry of preparedItems) {
        earliestNeededBy = resolveEarliestNeededBy(earliestNeededBy, entry.neededBy);
        const aggregationKey = entry.item.sapItemCode?.trim()
          ? `project:${entry.projectId}:sap:${entry.item.sapItemCode.trim()}`
          : `project:${entry.projectId}:item:${entry.processedItemId}`;
        const existingLine = aggregatedLines.get(aggregationKey);

        if (existingLine) {
          const nextQuantity =
            Number(existingLine.quantity ?? 0) + Number(entry.item.quantity ?? 0);
          existingLine.quantity = nextQuantity.toFixed(2);
          continue;
        }

        aggregatedLines.set(aggregationKey, {
          purchaseRequestItemId: null,
          materialRequestItemId: entry.processedItemId,
          originalSapItemCode: entry.item.sapItemCode,
          currentSapItemCode: entry.item.sapItemCode,
          itemName: entry.item.sapItemDescription || entry.item.itemName,
          quantity: entry.item.quantity,
          receivedQuantity: "0.00",
          unit: entry.item.unit,
          notes: input.notes,
        });
      }

      const sourceRequestIds = Array.from(new Set(preparedItems.map((entry) => entry.requestId)));
      const sourceProjectIds = Array.from(new Set(preparedItems.map((entry) => entry.projectId)));

      const purchaseRequest = await db.createPurchaseRequest(
        {
          materialRequestId: sourceRequestIds.length === 1 ? sourceRequestIds[0] : null,
          sourcePurchaseOrderId: null,
          projectId: sourceProjectIds[0],
          purchaseType: "local",
          status: "pendiente",
          neededBy: earliestNeededBy ?? null,
          sapDocumentNumber: null,
          notes: input.notes ?? `Compra directa por ${input.paymentMethod}`,
          rejectionReason: null,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          quoteAttachmentId: null,
          createdById: ctx.user.id,
        },
        Array.from(aggregatedLines.values()).map((line) => ({
          materialRequestItemId: line.materialRequestItemId ?? null,
          originalSapItemCode: line.originalSapItemCode ?? null,
          currentSapItemCode: line.currentSapItemCode ?? null,
          itemName: line.itemName,
          quantity: line.quantity,
          receivedQuantity: "0.00",
          unit: line.unit,
          notes: line.notes,
        }))
      );

      for (const entry of preparedItems) {
        await db.createSupplyFlowRecord({
          requestId: entry.requestId,
          requestItemId: entry.processedItemId,
          flowType: "compra_directa",
          paymentMethod: input.paymentMethod,
          supplierId: input.supplierId,
          purchaseOrderNumber: purchaseRequest.requestNumber,
          sapDocumentType: "solicitud_compra",
          processedById: ctx.user.id,
          notes: input.notes,
          status: "pendiente",
        });
      }

      for (const requestId of requestIds) {
        await checkAndUpdateRequestStatus(requestId, ctx.user.id);
      }

      return {
        success: true,
        purchaseRequestId: purchaseRequest.id,
        purchaseRequestNumber: purchaseRequest.requestNumber,
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
      if (!canManageWarehouseOrTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central o Administración Central pueden despachar materiales",
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
      if (!canManageWarehouseOrTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central o Administración Central pueden gestionar traslados",
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
          sourcePurchaseOrderId: null,
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

        const directPurchaseRequestItemIds = detail.items
          .map((item: any) => item.materialRequestItemId)
          .filter((value: number | null | undefined): value is number => typeof value === "number");
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
          const current = directPurchaseFlowByRequestItemId.get(requestItemId) ?? [];
          current.push(linkedFlowItem);
          directPurchaseFlowByRequestItemId.set(requestItemId, current);
        }

        const itemsByProject = new Map<number, any[]>();
        for (const item of detail.items) {
          const sourceProjectId = item.sourceProject?.id ?? detail.purchaseRequest.projectId;
          const current = itemsByProject.get(sourceProjectId) ?? [];
          current.push(item);
          itemsByProject.set(sourceProjectId, current);
        }

        const createdOrders: Array<{
          projectId: number;
          purchaseOrderId: number;
          purchaseOrderNumber: string;
        }> = [];

        for (const [projectId, projectItems] of Array.from(itemsByProject.entries())) {
          const projectFlowItems = projectItems.flatMap((item: any) =>
            item.materialRequestItemId
              ? directPurchaseFlowByRequestItemId.get(item.materialRequestItemId) ?? []
              : []
          );

          const order = await db.createPurchaseOrder(
            {
              purchaseRequestId: detail.purchaseRequest.id,
              projectId,
              classification: projectFlowItems.length > 0 ? "cd" : "oc",
              purchaseType: detail.purchaseRequest.purchaseType,
              supplierId: projectFlowItems[0]?.flow?.supplierId ?? null,
              supplierEmail: null,
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
            purchaseOrderId: order.id,
            purchaseOrderNumber: order.orderNumber,
          });

          const updatedFlowIds = new Set<number>();
          for (const linkedFlowItem of projectFlowItems) {
            if (updatedFlowIds.has(linkedFlowItem.flow.id)) continue;
            updatedFlowIds.add(linkedFlowItem.flow.id);

            await db.updateSupplyFlowRecord(linkedFlowItem.flow.id, {
              purchaseOrderNumber: order.orderNumber,
              sapDocumentType: "orden_compra",
              status: "en_proceso",
              notes: input.notes ?? linkedFlowItem.flow.notes ?? undefined,
            });
          }
        }

        await db.updatePurchaseRequest(detail.purchaseRequest.id, {
          status: "convertida",
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
