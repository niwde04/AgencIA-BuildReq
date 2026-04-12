import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

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
});
