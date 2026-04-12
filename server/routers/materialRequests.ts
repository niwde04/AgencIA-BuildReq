import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

const requestItemSchema = z.object({
  itemName: z.string().min(1, "El nombre del ítem es obligatorio").max(500),
  quantity: z.string().min(1, "La cantidad es obligatoria"),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

export const materialRequestsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          status: z.string().optional(),
          requestedById: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      // Ing. Residente only sees their own requests
      if (user.buildreqRole === "ingeniero_residente") {
        return db.listMaterialRequests({
          ...input,
          requestedById: user.id,
        });
      }
      return db.listMaterialRequests(input ?? undefined);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const result = await db.getMaterialRequestById(input.id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada" });
      }
      // Ing. Residente can only see their own
      if (
        ctx.user.buildreqRole === "ingeniero_residente" &&
        result.request.requestedById !== ctx.user.id
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta solicitud" });
      }
      return result;
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        recipient: z.enum(["bodega_central", "administrador_proyecto", "solicitud_compra"]),
        notes: z.string().optional(),
        items: z.array(requestItemSchema).min(1, "Debe incluir al menos un ítem"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { items, ...requestData } = input;
      const result = await db.createMaterialRequest(
        {
          ...requestData,
          requestedById: ctx.user.id,
        },
        items
      );

      // Notify based on recipient
      if (input.recipient === "bodega_central") {
        const bodegaUsers = await db.getUsersByBuildreqRole("jefe_bodega_central");
        for (const bUser of bodegaUsers) {
          await db.createNotification({
            userId: bUser.id,
            title: "Nueva solicitud de materiales",
            message: `Se ha creado la solicitud ${result.requestNumber} dirigida a Bodega Central.`,
            type: "nueva_solicitud",
            relatedEntityType: "material_request",
            relatedEntityId: result.id,
          });
        }
      } else if (input.recipient === "solicitud_compra") {
        // Notify Admin Central when directed as Solicitud de Compra
        const adminUsers = await db.getUsersByBuildreqRole("administracion_central");
        for (const aUser of adminUsers) {
          await db.createNotification({
            userId: aUser.id,
            title: "Nueva solicitud de compra",
            message: `Se ha creado la solicitud ${result.requestNumber} como Solicitud de Compra.`,
            type: "solicitud_compra",
            relatedEntityType: "material_request",
            relatedEntityId: result.id,
          });
        }
      } else {
        // administrador_proyecto - notify both
        const bodegaUsers = await db.getUsersByBuildreqRole("jefe_bodega_central");
        for (const bUser of bodegaUsers) {
          await db.createNotification({
            userId: bUser.id,
            title: "Nueva solicitud de materiales",
            message: `Se ha creado la solicitud ${result.requestNumber} dirigida al Administrador de Proyecto.`,
            type: "nueva_solicitud",
            relatedEntityType: "material_request",
            relatedEntityId: result.id,
          });
        }
      }

      return result;
    }),

  // Status is now automatic - no manual status change needed
  // en_espera -> en_proceso (when at least 1 item has flow assigned)
  // en_proceso -> cerrada (when all items have flows assigned and completed)
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["en_espera", "en_proceso", "cerrada"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.buildreqRole === "ingeniero_residente") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cambiar el estatus",
        });
      }

      const result = await db.updateMaterialRequestStatus(
        input.id,
        input.status,
        ctx.user.id
      );

      // Notify the requesting engineer
      const request = await db.getMaterialRequestById(input.id);
      if (request) {
        const statusLabels: Record<string, string> = {
          en_espera: "En espera",
          en_proceso: "En proceso de atención",
          cerrada: "Cerrada",
        };
        await db.createNotification({
          userId: request.request.requestedById,
          title: "Cambio de estatus en solicitud",
          message: `La solicitud ${request.request.requestNumber} cambió a: ${statusLabels[input.status]}`,
          type: "cambio_estatus",
          relatedEntityType: "material_request",
          relatedEntityId: input.id,
        });
      }

      return result;
    }),

  // Send all items to SAP - batch operation
  sendToSap: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole === "ingeniero_residente"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para enviar a SAP",
        });
      }

      const request = await db.getMaterialRequestById(input.requestId);
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada" });
      }

      // Verify all items have flows and SAP codes assigned
      const unassignedItems = request.items.filter(
        (item) => !item.assignedFlow || !item.sapItemCode
      );
      if (unassignedItems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Hay ${unassignedItems.length} ítem(s) sin flujo o código SAP asignado. Complete todos los ítems antes de enviar a SAP.`,
        });
      }

      // Create SAP sync log entries for each item's flow
      const sapDocTypeMap: Record<string, string> = {
        despacho_bodega: "Salida de Inventario",
        solicitud_compra: "Solicitud de Compra",
        traslado_proyecto: "Solicitud de Transferencia",
        compra_directa: "Orden de Compra", // First step for compra_directa
      };

      for (const item of request.items) {
        await db.createSapSyncLog({
          entityType: "supply_flow",
          entityId: input.requestId,
          sapDocumentType: sapDocTypeMap[item.assignedFlow!] || "Desconocido",
          status: "pending",
          requestPayload: JSON.stringify({
            requestNumber: request.request.requestNumber,
            itemCode: item.sapItemCode,
            itemDescription: item.sapItemDescription || item.itemName,
            quantity: item.quantity,
            unit: item.unit,
            flow: item.assignedFlow,
            projectCode: request.project?.code,
          }),
        });
      }

      // Update request status to cerrada
      await db.updateMaterialRequestStatus(input.requestId, "cerrada", ctx.user.id);

      // Notify the requesting engineer
      await db.createNotification({
        userId: request.request.requestedById,
        title: "Solicitud enviada a SAP",
        message: `La solicitud ${request.request.requestNumber} ha sido procesada y enviada a SAP.`,
        type: "cambio_estatus",
        relatedEntityType: "material_request",
        relatedEntityId: input.requestId,
      });

      return { success: true, itemsProcessed: request.items.length };
    }),
});
