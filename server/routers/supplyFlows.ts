import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

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
    .query(async ({ input }) => {
      return db.listSupplyFlowRecords(input ?? undefined);
    }),

  getByRequestId: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .query(async ({ input }) => {
      return db.getSupplyFlowByRequestId(input.requestId);
    }),

  /** Returns which flow types the current user's role can assign */
  availableFlows: protectedProcedure.query(({ ctx }) => {
    const role = ctx.user.buildreqRole;
    const isAdmin = ctx.user.role === "admin";

    if (isAdmin || role === "jefe_bodega_central") {
      // Jefe de Bodega sees all 4 flows
      return [
        "compra_directa",
        "despacho_bodega",
        "traslado_proyecto",
        "solicitud_compra",
      ];
    }
    if (role === "administracion_central") {
      // Admin Central only sees Compra Directa and Solicitud de Compra
      return ["compra_directa", "solicitud_compra"];
    }
    // Ingeniero Residente cannot assign flows
    return [];
  }),

  /** SAP document type mapping for each flow */
  sapMapping: protectedProcedure.query(() => {
    return {
      despacho_bodega: {
        sapDocument: "Salida de Inventario",
        sapModule: "Inventario",
        description: "Genera una Salida de Inventario en SAP",
      },
      solicitud_compra: {
        sapDocument: "Solicitud de Compra",
        sapModule: "Compras",
        description: "Genera una Solicitud de Compra en SAP que Administración Central convierte en Orden de Compra",
      },
      traslado_proyecto: {
        sapDocument: "Solicitud de Transferencia",
        sapModule: "Inventario",
        description: "Genera una Solicitud de Transferencia de inventario entre almacenes en SAP",
      },
      compra_directa: {
        sapDocument: "Orden de Compra → Entrada de Mercancías",
        sapModule: "Compras",
        description: "Primero genera una Orden de Compra, y al recibir el producto genera una Entrada de Mercancías en SAP",
        twoStepFlow: true,
        step1: "Orden de Compra",
        step2: "Entrada de Mercancías",
      },
    };
  }),

  // Flow 1: Compra directa del proyecto (per item) - Two step: OC -> Entrada Mercancía
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
      const role = ctx.user.buildreqRole;
      const isAdmin = ctx.user.role === "admin";
      if (
        role === "ingeniero_residente" ||
        (!isAdmin && role !== "jefe_bodega_central" && role !== "administracion_central")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar compras directas",
        });
      }

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "compra_directa",
        status: "pendiente",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      // Generate auto-correlative for purchase order
      const poNumber = await db.generatePurchaseOrderNumber();

      // Step 1: Create OC (Orden de Compra) first
      const result = await db.createSupplyFlowRecord({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        flowType: "compra_directa",
        paymentMethod: input.paymentMethod,
        supplierId: input.supplierId,
        purchaseOrderNumber: poNumber,
        sapDocumentType: "orden_compra",
        processedById: ctx.user.id,
        notes: input.notes,
        status: "en_proceso",
      });

      await db.createSapSyncLog({
        entityType: "supply_flow",
        entityId: result.id,
        sapDocumentType: "Orden de Compra",
        status: "pending",
        requestPayload: JSON.stringify({
          type: "purchase_order",
          step: 1,
          purchaseOrderNumber: poNumber,
          paymentMethod: input.paymentMethod,
          supplierId: input.supplierId,
          requestId: input.requestId,
          requestItemId: input.requestItemId,
          nextStep: "Entrada de Mercancías (al recibir producto)",
        }),
      });

      return result;
    }),

  // Confirm goods receipt for direct purchase (Step 2)
  confirmGoodsReceipt: protectedProcedure
    .input(
      z.object({
        flowId: z.number(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = ctx.user.buildreqRole;
      const isAdmin = ctx.user.role === "admin";
      if (
        role === "ingeniero_residente" ||
        (!isAdmin && role !== "jefe_bodega_central" && role !== "administracion_central")
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

      await db.createSapSyncLog({
        entityType: "supply_flow",
        entityId: input.flowId,
        sapDocumentType: "Entrada de Mercancías",
        status: "pending",
        requestPayload: JSON.stringify({
          type: "goods_receipt",
          step: 2,
          flowId: input.flowId,
        }),
      });

      return { success: true };
    }),

  // Flow 2: Despacho desde Bodega Central (per item) -> Salida de Inventario SAP
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

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "despacho_bodega",
        status: "completo",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      const result = await db.createSupplyFlowRecord({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        flowType: "despacho_bodega",
        sourceWarehouse: input.sourceWarehouse,
        sapDocumentType: "salida_inventario",
        processedById: ctx.user.id,
        notes: input.notes,
        status: "en_proceso",
      });

      await db.createSapSyncLog({
        entityType: "supply_flow",
        entityId: result.id,
        sapDocumentType: "Salida de Inventario",
        status: "pending",
        requestPayload: JSON.stringify({
          type: "goods_issue",
          sourceWarehouse: input.sourceWarehouse,
          requestId: input.requestId,
          requestItemId: input.requestItemId,
        }),
      });

      return result;
    }),

  // Flow 3: Traslado entre proyectos (per item) -> Solicitud de Transferencia SAP
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

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "traslado_proyecto",
        status: "completo",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

      const result = await db.createSupplyFlowRecord({
        requestId: input.requestId,
        requestItemId: input.requestItemId,
        flowType: "traslado_proyecto",
        sourceProjectId: input.sourceProjectId,
        destinationProjectId: input.destinationProjectId,
        sapDocumentType: "transferencia_inventario",
        processedById: ctx.user.id,
        notes: input.notes,
        status: "en_proceso",
      });

      await db.createSapSyncLog({
        entityType: "supply_flow",
        entityId: result.id,
        sapDocumentType: "Solicitud de Transferencia",
        status: "pending",
        requestPayload: JSON.stringify({
          type: "inventory_transfer_request",
          sourceProjectId: input.sourceProjectId,
          destinationProjectId: input.destinationProjectId,
          requestId: input.requestId,
          requestItemId: input.requestItemId,
        }),
      });

      return result;
    }),

  // Flow 4: Solicitud de compra (per item) -> Solicitud de Compra SAP
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
      const role = ctx.user.buildreqRole;
      const isAdmin = ctx.user.role === "admin";
      if (
        role === "ingeniero_residente" ||
        (!isAdmin && role !== "jefe_bodega_central" && role !== "administracion_central")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de compra",
        });
      }

      await db.updateRequestItem(input.requestItemId, {
        assignedFlow: "solicitud_compra",
        status: "pendiente",
      });

      await checkAndUpdateRequestStatus(input.requestId, ctx.user.id);

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

      // Notify Admin Central
      const adminUsers = await db.getUsersByBuildreqRole("administracion_central");
      for (const aUser of adminUsers) {
        await db.createNotification({
          userId: aUser.id,
          title: "Nueva solicitud de compra",
          message: `Se ha generado una solicitud de compra (${input.purchaseType}) para un ítem.`,
          type: "solicitud_compra",
          relatedEntityType: "supply_flow",
          relatedEntityId: result.id,
        });
      }

      await db.createSapSyncLog({
        entityType: "supply_flow",
        entityId: result.id,
        sapDocumentType: "Solicitud de Compra",
        status: "pending",
        requestPayload: JSON.stringify({
          type: "purchase_request",
          purchaseType: input.purchaseType,
          requestId: input.requestId,
          requestItemId: input.requestItemId,
        }),
      });

      return result;
    }),

  // Convert purchase request to purchase order (Admin Central)
  convertToPurchaseOrder: protectedProcedure
    .input(
      z.object({
        flowId: z.number(),
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

      // Auto-generate purchase order number
      const purchaseOrderNumber = await db.generatePurchaseOrderNumber();

      const result = await db.updateSupplyFlowRecord(input.flowId, {
        purchaseOrderNumber,
        sapDocumentType: "orden_compra",
        status: "en_proceso",
        notes: input.notes,
      });

      await db.createSapSyncLog({
        entityType: "supply_flow",
        entityId: input.flowId,
        sapDocumentType: "Orden de Compra",
        status: "pending",
        requestPayload: JSON.stringify({
          type: "purchase_order",
          purchaseOrderNumber,
        }),
      });

      return result;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pendiente", "en_proceso", "completado", "cancelado"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.updateSupplyFlowRecord(input.id, {
        status: input.status,
        notes: input.notes,
      });
    }),
});

/** Helper: check if all items in a request have flows assigned and update request status automatically */
async function checkAndUpdateRequestStatus(requestId: number, userId: number) {
  const items = await db.getRequestItemsByRequestId(requestId);
  const someAssigned = items.some((item) => item.assignedFlow !== null);
  const allAssigned = items.length > 0 && items.every((item) => item.assignedFlow !== null);

  if (allAssigned) {
    // All items have flows - mark as en_proceso (will become cerrada when sent to SAP)
    await db.updateMaterialRequestStatus(requestId, "en_proceso", userId);
  } else if (someAssigned) {
    // Partial assignment - auto change to en_proceso
    await db.updateMaterialRequestStatus(requestId, "en_proceso", userId);
  }
  // If none assigned, stays en_espera
}
