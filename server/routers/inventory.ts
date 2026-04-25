import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

function assertCanReadInventory(ctx: { user: { buildreqRole?: string | null } }) {
  if (ctx.user.buildreqRole === "ingeniero_residente") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al inventario",
    });
  }
}

export const inventoryRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          search: z.string().optional(),
          isActive: z.boolean().optional(),
          warehouseId: z.number().int().positive().optional(),
          projectId: z.number().int().positive().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(200).optional(),
          sortBy: z
            .enum([
              "sapItemCode",
              "name",
              "category",
              "unit",
              "currentStock",
              "minimumStock",
              "warehouseLocation",
              "projectName",
            ])
            .optional(),
          sortDir: z.enum(["asc", "desc"]).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      assertCanReadInventory(ctx);
      return db.listInventoryItems(input ?? undefined);
    }),

  tracking: protectedProcedure
    .input(
      z.object({
        sapItemCode: z.string().min(1),
        projectId: z.number().int().positive().nullable().optional(),
        warehouseId: z.number().int().positive().nullable().optional(),
        warehouseLocation: z.string().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      assertCanReadInventory(ctx);
      return db.getInventoryTracking(input);
    }),

  kardex: protectedProcedure
    .input(
      z.object({
        sapItemCode: z.string().min(1),
        projectId: z.number().int().positive().nullable().optional(),
        warehouseId: z.number().int().positive().nullable().optional(),
        warehouseLocation: z.string().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      assertCanReadInventory(ctx);
      return db.getInventoryKardex(input);
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
        projectId: z.number().int().positive().optional(),
        warehouseId: z.number().int().positive().optional(),
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
        projectId: z.number().int().positive().nullable().optional(),
        warehouseId: z.number().int().positive().nullable().optional(),
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
      if (input.projectId !== undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Los movimientos entre proyectos deben gestionarse desde requisiciones, traslados y recepciones.",
        });
      }
      const { id, ...data } = input;
      return db.updateInventoryItem(id, data);
    }),

  bulkAssignProject: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1),
        projectId: z.number().int().positive().nullable(),
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Los movimientos masivos entre proyectos deben gestionarse desde requisiciones, traslados y recepciones.",
      });
    }),

  bulkAssignProjectByFilters: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
        warehouseId: z.number().int().positive().optional(),
        projectId: z.number().int().positive().optional(),
        targetProjectId: z.number().int().positive().nullable(),
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Los movimientos masivos entre proyectos deben gestionarse desde requisiciones, traslados y recepciones.",
      });
    }),
});
