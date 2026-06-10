import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

const returnItemSchema = z.object({
  sourceWarehouseExitItemId: z.number().optional(),
  warehouseId: z.number().int().positive().optional(),
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
        destinationWarehouseId: z.number().int().positive().optional(),
        sourceWarehouseExitId: z.number().optional(),
        sourceReceiptId: z.number().optional(),
        supplierName: z.string().optional(),
        receivedByName: z
          .string()
          .trim()
          .min(1, "Recibido por es obligatorio")
          .max(255, "Recibido por no puede exceder 255 caracteres"),
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

      let supplierNameFromReceipt: string | undefined;
      let sourceReceiptDetail:
        | Awaited<ReturnType<typeof db.getReceiptById>>
        | undefined;

      if (input.returnType === "devolucion_proveedor") {
        if (!input.sourceReceiptId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Para devoluciones a proveedor, debe seleccionar una recepción completada",
          });
        }

        sourceReceiptDetail = await db.getReceiptById(input.sourceReceiptId);
        if (!sourceReceiptDetail) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recepción seleccionada no encontrada",
          });
        }

        if (
          sourceReceiptDetail.receipt.sourceType !== "purchase_order" ||
          sourceReceiptDetail.receipt.status !== "completa"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Solo se pueden devolver a proveedor recepciones de orden de compra completadas",
          });
        }

        if (sourceReceiptDetail.receipt.projectId !== input.sourceProjectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "El proyecto origen debe coincidir con la recepción seleccionada",
          });
        }

        const purchaseOrderDetail = await db.getPurchaseOrderById(
          sourceReceiptDetail.receipt.sourceId
        );
        if (!purchaseOrderDetail?.supplier) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "La recepción seleccionada no tiene proveedor asociado",
          });
        }

        supplierNameFromReceipt = [
          purchaseOrderDetail.supplier.supplierCode,
          purchaseOrderDetail.supplier.name,
        ]
          .filter(Boolean)
          .join(" — ");
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
      if (
        input.returnType === "devolucion_entre_proyectos" &&
        !input.destinationWarehouseId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Para devoluciones entre proyectos, debe indicar la bodega destino",
        });
      }
      if (
        input.returnType === "devolucion_entre_proyectos" &&
        input.destinationProjectId &&
        input.destinationWarehouseId
      ) {
        const destinationWarehouses = await db.listProjectWarehouses(
          input.destinationProjectId,
          { isActive: true }
        );
        const validDestinationWarehouse = destinationWarehouses.some(
          warehouse => warehouse.id === input.destinationWarehouseId
        );
        if (!validDestinationWarehouse) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "La bodega destino seleccionada no pertenece al proyecto destino o no está activa",
          });
        }
      }

      const { items, ...returnData } = input;
      if (
        input.returnType === "devolucion_proveedor" ||
        input.returnType === "devolucion_bodega_central" ||
        input.returnType === "devolucion_bodega_proyecto" ||
        input.returnType === "devolucion_entre_proyectos"
      ) {
        const missingWarehouseItem = items.find(item => !item.warehouseId);
        if (
          missingWarehouseItem &&
          !(
            input.returnType === "devolucion_bodega_proyecto" &&
            input.sourceWarehouseExitId
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Seleccione almacén para ${missingWarehouseItem.itemName}`,
          });
        }
      }
      if (
        input.returnType === "devolucion_bodega_central" ||
        input.returnType === "devolucion_entre_proyectos" ||
        (input.returnType === "devolucion_bodega_proyecto" &&
          !input.sourceWarehouseExitId)
      ) {
        const activeWarehouses = await db.listProjectWarehouses(
          input.sourceProjectId,
          { isActive: true }
        );
        const activeWarehouseIds = new Set(
          activeWarehouses.map((warehouse) => warehouse.id)
        );
        const invalidWarehouseItem = items.find(
          (item) => !item.warehouseId || !activeWarehouseIds.has(item.warehouseId)
        );
        if (invalidWarehouseItem) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El almacén seleccionado para ${invalidWarehouseItem.itemName} no pertenece al proyecto origen o no está activo`,
          });
        }
      }
      if (input.returnType === "devolucion_proveedor" && sourceReceiptDetail) {
        const receiptWarehouseIds = new Set(
          sourceReceiptDetail.items
            .map((item: any) => item.warehouseId)
            .filter((warehouseId: unknown): warehouseId is number =>
              typeof warehouseId === "number"
            )
        );
        const invalidWarehouseItem = items.find(
          (item) => !item.warehouseId || !receiptWarehouseIds.has(item.warehouseId)
        );
        if (invalidWarehouseItem) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El almacén de ${invalidWarehouseItem.itemName} debe venir de la recepción seleccionada`,
          });
        }
      }
      const normalizedReturnData =
        input.returnType === "devolucion_proveedor"
          ? {
              ...returnData,
              supplierName: supplierNameFromReceipt,
              sapDocumentType: "nota_credito",
            }
          : returnData;
      const result =
        input.returnType === "devolucion_bodega_proyecto" &&
        input.sourceWarehouseExitId
          ? await db.createWarehouseExitProjectReturn({
              sourceWarehouseExitId: input.sourceWarehouseExitId,
              reasonCategory: input.reasonCategory,
              justification: input.justification,
              receivedByName: input.receivedByName,
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
                ...normalizedReturnData,
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

  generateCreditNote: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central puede generar notas de crédito",
        });
      }

      try {
        const result = await db.generateSupplierReturnCreditNote(
          input.id,
          ctx.user.id
        );

        const returnRecord = await db.getReverseLogisticById(input.id);
        if (returnRecord) {
          await db.createNotification({
            userId: returnRecord.return.createdById,
            title: "Nota de crédito generada",
            message: `Se generó la nota de crédito ${result.sapDocumentNumber} para la devolución ${returnRecord.return.returnNumber}.`,
            type: "devolucion",
            relatedEntityType: "reverse_logistic",
            relatedEntityId: input.id,
          });
        }

        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo generar la nota de crédito",
        });
      }
    }),

  createCentralWarehouseTransfer: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Jefe de Bodega Central puede crear traslados de devoluciones",
        });
      }

      try {
        const result = await db.createTransferFromReverseLogistic(
          input.id,
          ctx.user.id
        );

        const returnRecord = await db.getReverseLogisticById(input.id);
        if (returnRecord) {
          await db.createNotification({
            userId: returnRecord.return.createdById,
            title: "Traslado creado para devolución",
            message: `Se generó la solicitud de traslado ${result.requestNumber} para la devolución ${returnRecord.return.returnNumber}.`,
            type: "devolucion",
            relatedEntityType: "reverse_logistic",
            relatedEntityId: input.id,
          });
        }

        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo crear el traslado de la devolución",
        });
      }
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
