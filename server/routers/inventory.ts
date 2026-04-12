import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

export const inventoryRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          search: z.string().optional(),
          isActive: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      // Only Jefe Bodega and Admin can see inventory
      if (
        ctx.user.buildreqRole === "ingeniero_residente"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso al inventario",
        });
      }
      return db.listInventoryItems(input ?? undefined);
    }),

  create: protectedProcedure
    .input(
      z.object({
        sapItemCode: z.string().min(1),
        name: z.string().min(1).max(500),
        description: z.string().optional(),
        unit: z.string().optional(),
        category: z.string().optional(),
        currentStock: z.string().optional(),
        minimumStock: z.string().optional(),
        warehouseLocation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Jefe de Bodega Central puede gestionar inventario",
        });
      }
      return db.createInventoryItem(input);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        unit: z.string().optional(),
        category: z.string().optional(),
        currentStock: z.string().optional(),
        minimumStock: z.string().optional(),
        warehouseLocation: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole !== "jefe_bodega_central" &&
        ctx.user.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Jefe de Bodega Central puede gestionar inventario",
        });
      }
      const { id, ...data } = input;
      return db.updateInventoryItem(id, data);
    }),
});
