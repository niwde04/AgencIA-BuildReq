import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

function canAssignFlows(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canManageSapTranslation(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
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

  return { item, detail };
}

async function syncRequestStatusFromAssignments(requestId: number, userId: number) {
  const items = await db.getRequestItemsByRequestId(requestId);
  const someAssigned = items.some((item) => item.assignedFlow !== null);

  await db.updateMaterialRequestStatus(
    requestId,
    someAssigned ? "en_proceso" : "en_espera",
    userId
  );
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

export const requestItemsRouter = router({
  getByRequestId: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .query(async ({ input }) => {
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
      const { item } = await assertItemApprovedForProcessing(input.id);
      await assertSapTranslationCanBeChanged(item);

      return db.updateRequestItem(input.id, {
        sapItemCode: input.sapItemCode,
        sapItemDescription: input.sapItemDescription,
      });
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

      const { item } = await assertItemApprovedForProcessing(input.id);
      await assertSapTranslationCanBeChanged(item);

      const clearedFlow = Boolean(item.assignedFlow);

      await db.updateRequestItem(item.id, {
        sapItemCode: null,
        sapItemDescription: null,
        assignedFlow: null,
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

      if (
        detail.request.status === "borrador" ||
        detail.request.status === "flujo_completado" ||
        detail.request.status === "cerrada" ||
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

      await db.updateRequestItem(item.id, {
        assignedFlow: input.flowType,
        status: "pendiente",
      });
      await syncRequestStatusFromAssignments(item.requestId, ctx.user.id);

      return { success: true };
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
      if (ctx.user.buildreqRole === "ingeniero_residente") {
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
        note: z.string().optional(),
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
            "Solo el Jefe de Bodega Central o Administración Central pueden registrar salida de bodega",
        });
      }

      await assertItemApprovedForProcessing(input.requestItemId);
      return db.recordWarehouseExit({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        quantity: input.dispatchedQuantity,
        note: input.note,
        processedById: ctx.user.id,
      });
    }),

  recordWarehouseExitBatch: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        items: z
          .array(
            z.object({
              requestItemId: z.number(),
              dispatchedQuantity: z.string(),
            })
          )
          .min(1),
        note: z.string().optional(),
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
            "Solo el Jefe de Bodega Central o Administración Central pueden registrar salida de bodega",
        });
      }

      for (const item of input.items) {
        await assertItemApprovedForProcessing(item.requestItemId);
      }

      return db.recordWarehouseExitBatch({
        requestId: input.requestId,
        items: input.items.map((item) => ({
          requestItemId: item.requestItemId,
          quantity: item.dispatchedQuantity,
        })),
        note: input.note,
        processedById: ctx.user.id,
      });
    }),

  returnDispatchToRequisition: protectedProcedure
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
            "Solo el Jefe de Bodega Central o Administración Central pueden devolver una salida a requisición",
        });
      }

      const { item } = await assertItemApprovedForProcessing(input.id);
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
});
