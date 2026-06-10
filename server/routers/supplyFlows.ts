import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function canManageSupply(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canManageDirectPurchase(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canManagePurchaseRequestFlow(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

const purchaseTypeSchema = z.enum(["local", "extranjera", "compra_directa"]);
const directPurchasePaymentMethodSchema = z.enum([
  "linea_credito",
  "fondo_proyecto",
  "caja_chica",
]);

function getPaymentMethodLabel(paymentMethod?: string | null) {
  if (paymentMethod === "linea_credito") return "Línea de crédito";
  if (paymentMethod === "fondo_proyecto" || paymentMethod === "caja_chica") {
    return "Fondo del proyecto";
  }
  return paymentMethod ?? "Sin método";
}

function canConvertToPurchaseOrder(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function assertProjectScopedConversionAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  projectId: number
) {
  if (user.role === "admin") return;
  if (
    user.buildreqRole === "administrador_proyecto" &&
    !canAccessProject(user, projectId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para crear OC de otro proyecto",
    });
  }
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

function canViewSupplyFlowRequest(
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
  if (
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "superintendente"
  ) {
    return canAccessProject(user, request.projectId);
  }
  return true;
}

function scopeSupplyFlowFilters(
  user: {
    id: number;
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  filters?: {
    flowType?: string;
    status?: string;
  }
) {
  const scopedFilters: {
    flowType?: string;
    status?: string;
    requestedById?: number;
    projectId?: number;
    projectIds?: number[];
  } = { ...(filters ?? {}) };

  if (user.role === "admin") {
    return scopedFilters;
  }

  if (user.buildreqRole === "ingeniero_residente") {
    return { ...scopedFilters, requestedById: user.id };
  }

  if (
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "superintendente"
  ) {
    return applyProjectScope(scopedFilters, user);
  }

  return scopedFilters;
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
        "La requisición todavía está pendiente de autorización del Administrador del Proyecto, Administración Central o Jefe de Bodega",
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

function parseQuantity(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQuantity(value: unknown) {
  return parseQuantity(value).toFixed(2);
}

function getStockKey(item: { sapItemCode?: string | null; itemName: string }) {
  const sapItemCode = item.sapItemCode?.trim();
  return sapItemCode
    ? `sap:${sapItemCode}`
    : `name:${item.itemName.trim().toLowerCase()}`;
}

async function assertTransferSourceStock(
  sourceProjectId: number,
  preparedItems: Array<{ item: any; sourceWarehouseId?: number | null }>
) {
  const stockByKey = new Map<
    string,
    { itemName: string; availableQuantity: number; requestedQuantity: number }
  >();

  for (const { item, sourceWarehouseId } of preparedItems) {
    if (!sourceWarehouseId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Seleccione almacén origen para ${item.itemName}`,
      });
    }
    const stockRows = await db.listProjectStockForItems({
      projectId: sourceProjectId,
      items: [
        {
          id: item.id,
          sapItemCode: item.sapItemCode,
          itemName: item.itemName,
        },
      ],
    });
    const stockRow = stockRows[0] as any;
    const warehouseStock = (stockRow?.warehouses ?? []).find(
      (entry: any) => Number(entry.warehouseId) === sourceWarehouseId
    );
    const availableQuantity = parseQuantity(warehouseStock?.quantity);
    const requestedQuantity = parseQuantity(item.quantity);
    const key = `${getStockKey(item)}::${sourceWarehouseId}`;
    const current = stockByKey.get(key) ?? {
      itemName: item.itemName,
      availableQuantity,
      requestedQuantity: 0,
    };
    current.availableQuantity = availableQuantity;
    current.requestedQuantity += requestedQuantity;
    stockByKey.set(key, current);
  }

  for (const stock of Array.from(stockByKey.values())) {
    if (
      stock.availableQuantity <= 0 ||
      stock.availableQuantity + 0.000001 < stock.requestedQuantity
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La bodega origen no tiene existencia suficiente para ${stock.itemName}. Disponible: ${formatQuantity(
          stock.availableQuantity
        )}, solicitado: ${formatQuantity(stock.requestedQuantity)}.`,
      });
    }
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

  return candidateDate.getTime() < currentDate.getTime()
    ? candidateDate
    : currentDate;
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
    .query(async ({ ctx, input }) =>
      db.listSupplyFlowRecords(
        scopeSupplyFlowFilters(ctx.user, input ?? undefined)
      )
    ),

  pendingQueue: protectedProcedure
    .input(
      z
        .object({
          flowType: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      db.listPendingFlowQueueItems(
        scopeSupplyFlowFilters(ctx.user, input ?? undefined)
      )
    ),

  getByRequestId: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .query(async ({ ctx, input }) => {
      const detail = await db.getMaterialRequestById(input.requestId);
      if (!detail) return [];
      if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      return db.getSupplyFlowByRequestId(input.requestId);
    }),

  availableFlows: protectedProcedure.query(({ ctx }) => {
    if (ctx.user.buildreqRole === "administrador_proyecto") {
      return ["compra_directa", "solicitud_compra"];
    }

    if (ctx.user.buildreqRole === "bodeguero_proyecto") {
      return ["compra_directa", "traslado_proyecto"];
    }

    if (!canManageSupply(ctx.user)) return [];

    if (canManageWarehouseOrTransfers(ctx.user)) {
      return [
        "despacho_bodega",
        "compra_directa",
        "traslado_proyecto",
        "solicitud_compra",
      ];
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
        paymentMethod: directPurchasePaymentMethodSchema,
        supplierId: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageDirectPurchase(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar compras directas",
        });
      }

      const { detail, item } = await getRequestAndItem(
        input.requestId,
        input.requestItemId
      );
      if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
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
          purchaseType: "compra_directa",
          supplierId: input.supplierId,
          supplierEmail: null,
          status: "emitida",
          neededBy: detail.request.neededBy,
          sapDocumentNumber: null,
          notes:
            input.notes ??
            `Compra directa por ${getPaymentMethodLabel(input.paymentMethod)}`,
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
                .refine(
                  value => Number.isFinite(Number(value)) && Number(value) > 0,
                  {
                    message: "La cantidad debe ser un numero mayor que cero",
                  }
                ),
            })
          )
          .min(1),
        supplierId: z.number().optional(),
        paymentMethod: directPurchasePaymentMethodSchema,
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageDirectPurchase(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar compras directas",
        });
      }

      const uniqueItems = Array.from(
        new Map(
          input.items.map(item => {
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
        new Set(uniqueItems.map(item => item.requestId))
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
              "La requisición todavía está pendiente de autorización del Administrador del Proyecto, Administración Central o Jefe de Bodega",
          });
        }
        if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No tiene acceso a esta solicitud",
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

        const existingDirectPurchaseFlow =
          await db.getActiveSupplyFlowForRequestItem({
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
            neededBy: detail.request.neededBy
              ? new Date(detail.request.neededBy)
              : null,
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
          neededBy: detail.request.neededBy
            ? new Date(detail.request.neededBy)
            : null,
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
        earliestNeededBy = resolveEarliestNeededBy(
          earliestNeededBy,
          entry.neededBy
        );
        const aggregationKey = entry.item.sapItemCode?.trim()
          ? `project:${entry.projectId}:sap:${entry.item.sapItemCode.trim()}`
          : `project:${entry.projectId}:item:${entry.processedItemId}`;
        const targetKey =
          entry.item.targetType === "subproyecto"
            ? `subproject:${entry.item.subProjectId ?? "none"}`
            : entry.item.targetType === "activo_fijo"
              ? `asset:${entry.item.fixedAssetSapItemCode ?? "none"}`
              : "target:none";
        const lineKey = `${aggregationKey}:${targetKey}`;
        const existingLine = aggregatedLines.get(lineKey);

        if (existingLine) {
          const nextQuantity =
            Number(existingLine.quantity ?? 0) +
            Number(entry.item.quantity ?? 0);
          existingLine.quantity = nextQuantity.toFixed(2);
          continue;
        }

        aggregatedLines.set(lineKey, {
          purchaseRequestItemId: null,
          materialRequestItemId: entry.processedItemId,
          originalSapItemCode: entry.item.sapItemCode,
          currentSapItemCode: entry.item.sapItemCode,
          itemName: entry.item.sapItemDescription || entry.item.itemName,
          quantity: entry.item.quantity,
          receivedQuantity: "0.00",
          unit: entry.item.unit,
          targetType: entry.item.targetType,
          subProjectId: entry.item.subProjectId,
          fixedAssetSapItemCode: entry.item.fixedAssetSapItemCode,
          fixedAssetName: entry.item.fixedAssetName,
          notes: input.notes,
        });
      }

      const sourceRequestIds = Array.from(
        new Set(preparedItems.map(entry => entry.requestId))
      );
      const sourceProjectIds = Array.from(
        new Set(preparedItems.map(entry => entry.projectId))
      );

      const purchaseRequest = await db.createPurchaseRequest(
        {
          materialRequestId:
            sourceRequestIds.length === 1 ? sourceRequestIds[0] : null,
          sourcePurchaseOrderId: null,
          projectId: sourceProjectIds[0],
          purchaseType: "compra_directa",
          status: "pendiente",
          neededBy: earliestNeededBy ?? null,
          sapDocumentNumber: null,
          notes:
            input.notes ??
            `Compra directa por ${getPaymentMethodLabel(input.paymentMethod)}`,
          rejectionReason: null,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          quoteAttachmentId: null,
          createdById: ctx.user.id,
        },
        Array.from(aggregatedLines.values()).map(line => ({
          materialRequestItemId: line.materialRequestItemId ?? null,
          originalSapItemCode: line.originalSapItemCode ?? null,
          currentSapItemCode: line.currentSapItemCode ?? null,
          itemName: line.itemName,
          quantity: line.quantity,
          receivedQuantity: "0.00",
          unit: line.unit,
          targetType: line.targetType ?? null,
          subProjectId: line.subProjectId ?? null,
          fixedAssetSapItemCode: line.fixedAssetSapItemCode ?? null,
          fixedAssetName: line.fixedAssetName ?? null,
          notes: line.notes,
        }))
      );

      for (const entry of preparedItems) {
        await db.createSupplyFlowRecord({
          requestId: entry.requestId,
          requestItemId: entry.processedItemId,
          flowType: "compra_directa",
          paymentMethod: input.paymentMethod,
          supplierId: input.supplierId ?? null,
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
      if (
        !canManageSupply(ctx.user) ||
        ctx.user.buildreqRole === "ingeniero_residente"
      ) {
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
        sourceWarehouseId: z.number().int().positive().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseDispatch(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central, Administración Central o Bodeguero de Proyecto pueden despachar materiales",
        });
      }

      const { detail, item } = await getRequestAndItem(
        input.requestId,
        input.requestItemId
      );
      if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      if (!input.sourceWarehouseId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione almacén origen para el despacho",
        });
      }
      assertItemApprovedForProcessing(detail, item);
      await db.recordWarehouseExit({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        quantity: item.quantity,
        warehouseId: input.sourceWarehouseId,
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
        sourceWarehouseId: z.number().int().positive().optional(),
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
      if (!input.sourceWarehouseId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione almacén origen para el traslado",
        });
      }

      const { detail, item } = await getRequestAndItem(
        input.requestId,
        input.requestItemId
      );
      if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      assertItemApprovedForProcessing(detail, item);

      await assertTransferSourceStock(input.sourceProjectId, [
        { item, sourceWarehouseId: input.sourceWarehouseId },
      ]);

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
            sourceWarehouseId: input.sourceWarehouseId,
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

  createProjectTransferBatch: protectedProcedure
    .input(
      z.object({
        sourceProjectId: z.number(),
        notes: z.string().optional(),
        items: z
          .array(
            z.object({
              requestId: z.number(),
              requestItemId: z.number(),
              sourceWarehouseId: z.number().int().positive().optional(),
            })
          )
          .min(1),
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
      if (input.items.some((item) => !item.sourceWarehouseId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione almacén origen para todos los ítems del traslado",
        });
      }

      const uniqueItems = Array.from(
        new Map(
          input.items.map(item => [
            `${item.requestId}:${item.requestItemId}`,
            item,
          ])
        ).values()
      );
      const preparedItems: Array<{
        detail: any;
        item: any;
        sourceWarehouseId: number;
      }> = [];

      for (const entry of uniqueItems) {
        const { detail, item } = await getRequestAndItem(
          entry.requestId,
          entry.requestItemId
        );
        if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No tiene acceso a esta solicitud",
          });
        }
        assertItemApprovedForProcessing(detail, item);

        const existingTransferFlow = await db.getActiveSupplyFlowForRequestItem(
          {
            requestId: entry.requestId,
            requestItemId: entry.requestItemId,
            flowType: "traslado_proyecto",
          }
        );
        if (existingTransferFlow) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El ítem ${item.itemName} ya tiene una solicitud de traslado activa`,
          });
        }

        preparedItems.push({
          detail,
          item: {
            ...item,
            sourceWarehouseId: entry.sourceWarehouseId!,
          },
          sourceWarehouseId: entry.sourceWarehouseId!,
        });
      }

      const destinationProjectIds = Array.from(
        new Set(preparedItems.map(({ detail }) => detail.request.projectId))
      );
      if (destinationProjectIds.length !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Para crear una sola solicitud de traslado, seleccione ítems del mismo proyecto destino",
        });
      }

      const destinationProjectId = destinationProjectIds[0];
      await assertTransferSourceStock(input.sourceProjectId, preparedItems);

      let earliestNeededBy: Date | null = null;
      for (const { detail, item } of preparedItems) {
        earliestNeededBy = resolveEarliestNeededBy(
          earliestNeededBy,
          detail.request.neededBy ? new Date(detail.request.neededBy) : null
        );

        await db.updateRequestItem(item.id, {
          assignedFlow: "traslado_proyecto",
          status: "pendiente",
        });
      }

      const sourceRequestIds = Array.from(
        new Set(preparedItems.map(({ detail }) => detail.request.id))
      );
      const transferRequest = await db.createTransferRequest(
        {
          materialRequestId:
            sourceRequestIds.length === 1 ? sourceRequestIds[0] : null,
          projectId: input.sourceProjectId,
          destinationType: "proyecto",
          destinationProjectId,
          createdById: ctx.user.id,
          status: "pendiente",
          neededBy: earliestNeededBy,
          notes: input.notes,
          rejectionReason: null,
        },
        preparedItems.map(({ item }) => ({
          materialRequestItemId: item.id,
          sourceWarehouseId: item.sourceWarehouseId,
          itemName: item.sapItemDescription || item.itemName,
          sapItemCode: item.sapItemCode,
          quantity: item.quantity,
          receivedQuantity: "0.00",
          unit: item.unit,
          notes: input.notes,
        }))
      );

      const flowResults = [];
      for (const { detail, item } of preparedItems) {
        const result = await db.createSupplyFlowRecord({
          requestId: detail.request.id,
          requestItemId: item.id,
          flowType: "traslado_proyecto",
          sourceProjectId: input.sourceProjectId,
          destinationProjectId,
          sapDocumentType: "transferencia_inventario",
          sapDocumentNumber: transferRequest.requestNumber,
          processedById: ctx.user.id,
          notes: input.notes,
          status: "pendiente",
        });
        flowResults.push(result);
      }

      for (const requestId of sourceRequestIds) {
        await checkAndUpdateRequestStatus(requestId, ctx.user.id);
      }

      return {
        success: true,
        transferRequestId: transferRequest.id,
        transferRequestNumber: transferRequest.requestNumber,
        processedItems: preparedItems.length,
        flowIds: flowResults.map(result => result.id),
      };
    }),

  createPurchaseRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        requestItemId: z.number(),
        purchaseType: purchaseTypeSchema,
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManagePurchaseRequestFlow(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de compra",
        });
      }

      const { detail, item } = await getRequestAndItem(
        input.requestId,
        input.requestItemId
      );
      if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a esta solicitud",
        });
      }
      assertItemApprovedForProcessing(detail, item);
      const [existingPurchaseRequest, existingPurchaseRequestFlow] =
        await Promise.all([
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
            targetType: item.targetType,
            subProjectId: item.subProjectId,
            fixedAssetSapItemCode: item.fixedAssetSapItemCode,
            fixedAssetName: item.fixedAssetName,
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

      const adminUsers = await db.getUsersByBuildreqRole(
        "administracion_central"
      );
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

  createPurchaseRequestBatch: protectedProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              requestId: z.number(),
              requestItemId: z.number(),
            })
          )
          .min(1),
        purchaseType: purchaseTypeSchema,
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManagePurchaseRequestFlow(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de compra",
        });
      }

      const uniqueItems = Array.from(
        new Map(
          input.items.map(item => [
            `${item.requestId}:${item.requestItemId}`,
            item,
          ])
        ).values()
      );

      const preparedItems: Array<{ detail: any; item: any }> = [];
      for (const entry of uniqueItems) {
        const { detail, item } = await getRequestAndItem(
          entry.requestId,
          entry.requestItemId
        );
        if (!canViewSupplyFlowRequest(ctx.user, detail.request)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No tiene acceso a esta solicitud",
          });
        }
        assertItemApprovedForProcessing(detail, item);

        const [existingPurchaseRequest, existingPurchaseRequestFlow] =
          await Promise.all([
            db.getActivePurchaseRequestByMaterialRequestItemId(item.id),
            db.getActiveSupplyFlowForRequestItem({
              requestId: entry.requestId,
              requestItemId: entry.requestItemId,
              flowType: "solicitud_compra",
            }),
          ]);

        if (existingPurchaseRequest || existingPurchaseRequestFlow) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: existingPurchaseRequest
              ? `Ya existe la solicitud ${existingPurchaseRequest.purchaseRequest.requestNumber} para este ítem`
              : `Ya existe una solicitud de compra para el ítem ${item.itemName}`,
          });
        }

        preparedItems.push({ detail, item });
      }

      const projectIds = Array.from(
        new Set(preparedItems.map(({ detail }) => detail.request.projectId))
      );
      if (projectIds.length !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Seleccione ítems del mismo proyecto para consolidar en una sola solicitud de compra",
        });
      }

      const requestIds = Array.from(
        new Set(preparedItems.map(({ detail }) => detail.request.id))
      );
      let earliestNeededBy: Date | null = null;
      for (const { detail } of preparedItems) {
        earliestNeededBy = resolveEarliestNeededBy(
          earliestNeededBy,
          detail.request.neededBy
        );
      }

      for (const { item } of preparedItems) {
        await db.updateRequestItem(item.id, {
          assignedFlow: "solicitud_compra",
          status: "pendiente",
        });
      }

      const purchaseRequest = await db.createPurchaseRequest(
        {
          materialRequestId: requestIds.length === 1 ? requestIds[0] : null,
          sourcePurchaseOrderId: null,
          projectId: projectIds[0],
          createdById: ctx.user.id,
          purchaseType: input.purchaseType,
          status: "pendiente",
          neededBy: earliestNeededBy,
          sapDocumentNumber: null,
          notes: input.notes,
          rejectionReason: null,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          quoteAttachmentId: null,
        },
        preparedItems.map(({ item }) => ({
          materialRequestItemId: item.id,
          originalSapItemCode: item.sapItemCode,
          currentSapItemCode: item.sapItemCode,
          itemName: item.sapItemDescription || item.itemName,
          quantity: item.quantity,
          receivedQuantity: "0.00",
          unit: item.unit,
          targetType: item.targetType,
          subProjectId: item.subProjectId,
          fixedAssetSapItemCode: item.fixedAssetSapItemCode,
          fixedAssetName: item.fixedAssetName,
          notes: input.notes,
        }))
      );

      const flowResults = [];
      for (const { detail, item } of preparedItems) {
        const result = await db.createSupplyFlowRecord({
          requestId: detail.request.id,
          requestItemId: item.id,
          flowType: "solicitud_compra",
          purchaseType: input.purchaseType,
          sapDocumentType: "solicitud_compra",
          sapDocumentNumber: purchaseRequest.requestNumber,
          processedById: ctx.user.id,
          notes: input.notes,
          status: "pendiente",
        });
        flowResults.push(result);
      }

      for (const requestId of requestIds) {
        await checkAndUpdateRequestStatus(requestId, ctx.user.id);
      }

      const adminUsers = await db.getUsersByBuildreqRole(
        "administracion_central"
      );
      for (const user of adminUsers) {
        await db.createNotification({
          userId: user.id,
          title: "Nueva solicitud de compra",
          message: `Se generó la ${purchaseRequest.requestNumber} (${input.purchaseType}) con ${preparedItems.length} ítem(s).`,
          type: "solicitud_compra",
          relatedEntityType: "purchase_request",
          relatedEntityId: purchaseRequest.id,
        });
      }

      return {
        success: true,
        purchaseRequestId: purchaseRequest.id,
        purchaseRequestNumber: purchaseRequest.requestNumber,
        processedItems: preparedItems.length,
        flowIds: flowResults.map(result => result.id),
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
      if (!canConvertToPurchaseOrder(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o el Administrador del Proyecto puede convertir a Orden de Compra",
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
        assertProjectScopedConversionAccess(
          ctx.user,
          detail.purchaseRequest.projectId
        );
        const directPurchaseRequestItemIds = detail.items
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

        const itemsByProject = new Map<number, any[]>();
        for (const item of detail.items) {
          const sourceProjectId =
            item.sourceProject?.id ?? detail.purchaseRequest.projectId;
          assertProjectScopedConversionAccess(ctx.user, sourceProjectId);
          const current = itemsByProject.get(sourceProjectId) ?? [];
          current.push(item);
          itemsByProject.set(sourceProjectId, current);
        }

        const createdOrders: Array<{
          projectId: number;
          purchaseOrderId: number;
          purchaseOrderNumber: string;
        }> = [];

        for (const [projectId, projectItems] of Array.from(
          itemsByProject.entries()
        )) {
          const projectFlowItems = projectItems.flatMap((item: any) =>
            item.materialRequestItemId
              ? (directPurchaseFlowByRequestItemId.get(
                  item.materialRequestItemId
                ) ?? [])
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

      if (ctx.user.buildreqRole === "administrador_proyecto") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "El Administrador del Proyecto debe crear la OC desde una solicitud de compra",
        });
      }

      const flowDetail = await db.getSupplyFlowRecordById(input.flowId!);
      if (!flowDetail?.request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flujo origen no encontrado",
        });
      }
      assertProjectScopedConversionAccess(
        ctx.user,
        flowDetail.request.projectId
      );

      const purchaseOrderNumber = await db.generatePurchaseOrderNumber(
        flowDetail.request.projectId,
        flowDetail.flow.flowType === "compra_directa" ? "cd" : "oc"
      );
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
  try {
    await db.syncMaterialRequestFulfillmentStatus(requestId, userId);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "DB not available") {
      throw error;
    }

    const items = await db.getRequestItemsByRequestId(requestId);
    const someAssigned = items.some(item => item.assignedFlow !== null);

    if (someAssigned) {
      await db.updateMaterialRequestStatus(requestId, "en_proceso", userId);
    }
  }
}
