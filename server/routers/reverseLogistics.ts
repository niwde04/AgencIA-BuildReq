import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

const returnItemSchema = z.object({
  sourceWarehouseExitItemId: z.number().optional(),
  itemName: z.string().min(1, "El nombre del ítem es obligatorio").max(500),
  sapItemCode: z.string().optional(),
  quantity: z.string().min(1, "La cantidad es obligatoria"),
  unit: z.string().optional(),
  condition: z.enum(["nuevo", "usado_buen_estado", "defectuoso", "danado"]),
  notes: z.string().optional(),
});

export const reverseLogisticsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          returnType: z.string().optional(),
          status: z.string().optional(),
          sourceProjectId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return db.listReverseLogistics(input ?? undefined);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const result = await db.getReverseLogisticById(input.id);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Devolución no encontrada",
        });
      }
      return result;
    }),

  create: protectedProcedure
    .input(
      z.object({
        returnType: z.enum([
          "devolucion_bodega_central",
          "devolucion_bodega_proyecto",
          "devolucion_entre_proyectos",
          "devolucion_proveedor",
        ]),
        reasonCategory: z.enum([
          "material_defectuoso",
          "excedente",
          "error_pedido",
          "cambio_especificacion",
          "otro",
        ]),
        justification: z
          .string()
          .min(10, "La justificación debe tener al menos 10 caracteres"),
        sourceProjectId: z.number(),
        destinationProjectId: z.number().optional(),
        sourceWarehouseExitId: z.number().optional(),
        supplierName: z.string().optional(),
        originalRequestId: z.number().optional(),
        items: z
          .array(returnItemSchema)
          .min(1, "Debe incluir al menos un ítem"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Only Jefe de Bodega Central can create reverse logistics
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Jefe de Bodega Central puede generar devoluciones",
        });
      }

      // Validate: supplier returns need supplierName
      if (
        input.returnType === "devolucion_proveedor" &&
        !input.supplierName
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Para devoluciones a proveedor, debe indicar el nombre del proveedor",
        });
      }

      // Validate: project transfers need destinationProjectId
      if (
        input.returnType === "devolucion_entre_proyectos" &&
        !input.destinationProjectId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Para devoluciones entre proyectos, debe indicar el proyecto destino",
        });
      }

      const { items, ...returnData } = input;
      const result =
        input.returnType === "devolucion_bodega_proyecto" &&
        input.sourceWarehouseExitId
          ? await db.createWarehouseExitProjectReturn({
              sourceWarehouseExitId: input.sourceWarehouseExitId,
              reasonCategory: input.reasonCategory,
              justification: input.justification,
              createdById: ctx.user.id,
              items: input.items.map((item) => {
                if (!item.sourceWarehouseExitItemId) {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                      "Las devoluciones desde salida deben indicar el ítem origen",
                  });
                }

                return {
                  sourceWarehouseExitItemId: item.sourceWarehouseExitItemId,
                  quantity: item.quantity,
                  condition: item.condition,
                  notes: item.notes,
                };
              }),
            })
          : await db.createReverseLogistic(
              {
                ...returnData,
                createdById: ctx.user.id,
              },
              items
            );

      // Notify Jefe de Bodega
      const bodegaUsers = await db.getUsersByBuildreqRole(
        "jefe_bodega_central"
      );
      for (const bUser of bodegaUsers) {
        await db.createNotification({
          userId: bUser.id,
          title: "Nueva solicitud de devolución",
          message: `Se ha creado la devolución ${result.returnNumber} (${input.returnType.replace(/_/g, " ")}).`,
          type: "devolucion",
          relatedEntityType: "reverse_logistic",
          relatedEntityId: result.id,
        });
      }

      return result;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum([
          "pendiente",
          "aprobada",
          "en_transito",
          "recibida",
          "rechazada",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central puede actualizar el estatus de devoluciones",
        });
      }

      const result = await db.updateReverseLogisticStatus(
        input.id,
        input.status,
        ctx.user.id
      );

      // Notify the creator
      const returnRecord = await db.getReverseLogisticById(input.id);
      if (returnRecord) {
        const statusLabels: Record<string, string> = {
          pendiente: "Pendiente",
          aprobada: "Aprobada",
          en_transito: "En tránsito",
          recibida: "Recibida",
          rechazada: "Rechazada",
        };
        await db.createNotification({
          userId: returnRecord.return.createdById,
          title: "Cambio de estatus en devolución",
          message: `La devolución ${returnRecord.return.returnNumber} cambió a: ${statusLabels[input.status]}`,
          type: "devolucion",
          relatedEntityType: "reverse_logistic",
          relatedEntityId: input.id,
        });
      }

      return result;
    }),
});
