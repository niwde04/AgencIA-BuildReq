import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

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
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.buildreqRole !== "administracion_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para traducir ítems a códigos SAP",
        });
      }
      await assertItemApprovedForProcessing(input.id);
      return db.updateRequestItem(input.id, {
        sapItemCode: input.sapItemCode,
        sapItemDescription: input.sapItemDescription,
      });
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
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Jefe de Bodega puede registrar salida de bodega",
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
});
