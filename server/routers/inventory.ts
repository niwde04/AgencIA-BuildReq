import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function assertCanReadInventory(ctx: { user: { buildreqRole?: string | null } }) {
  if (ctx.user.buildreqRole === "ingeniero_residente") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al inventario",
    });
  }
}

function canReadGlobalAvailability(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

const WAREHOUSE_VIEWER_ROLES = new Set([
  "jefe_bodega_central",
  "bodeguero_proyecto",
]);

function canManageWarehousesGlobally(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central"
  );
}

function isWarehouseAssignedViewer(user: { buildreqRole?: string | null }) {
  return Boolean(
    user.buildreqRole && WAREHOUSE_VIEWER_ROLES.has(user.buildreqRole)
  );
}

export const inventoryRouter = router({
  projectStockForItems: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        items: z
          .array(
            z.object({
              id: z.number().int().positive(),
              sapItemCode: z.string().nullable().optional(),
              itemName: z.string().min(1),
            })
          )
          .max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const canReadTransferOriginStock =
        ctx.user.role === "admin" ||
        ctx.user.buildreqRole === "jefe_bodega_central" ||
        ctx.user.buildreqRole === "administracion_central" ||
        ctx.user.buildreqRole === "administrador_proyecto" ||
        ctx.user.buildreqRole === "bodeguero_proyecto";

      if (!canReadTransferOriginStock) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a existencias de proyecto origen",
        });
      }
      if (!canAccessProject(ctx.user, input.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a existencias de otro proyecto",
        });
      }

      return db.listProjectStockForItems(input);
    }),

  visibleWarehouseStockForItems: protectedProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              id: z.number().int().positive(),
              sapItemCode: z.string().nullable().optional(),
              itemName: z.string().min(1),
            })
          )
          .max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const canReadTransferOriginStock =
        ctx.user.role === "admin" ||
        ctx.user.buildreqRole === "jefe_bodega_central" ||
        ctx.user.buildreqRole === "administracion_central" ||
        ctx.user.buildreqRole === "administrador_proyecto" ||
        ctx.user.buildreqRole === "bodeguero_proyecto";

      if (!canReadTransferOriginStock) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a existencias de traslado",
        });
      }

      const baseFilters: {
        isActive: boolean;
        projectId?: number | null;
        projectIds?: number[] | null;
      } = { isActive: true };
      const scopedWarehouseFilters = applyProjectScope(baseFilters, ctx.user);
      const hideQuantities =
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole === "bodeguero_proyecto";
      const visibleWarehouses = canManageWarehousesGlobally(ctx.user) ||
        hideQuantities
        ? await db.listWarehouses({ isActive: true })
        : isWarehouseAssignedViewer(ctx.user)
          ? await db.listWarehouses({
              isActive: true,
              assignedUserId: ctx.user.id,
            })
          : await db.listWarehouses({
              isActive: scopedWarehouseFilters.isActive,
              projectId: scopedWarehouseFilters.projectId ?? undefined,
              projectIds: scopedWarehouseFilters.projectIds ?? undefined,
            });

      return db.listVisibleWarehouseStockForItems({
        warehouseIds: visibleWarehouses.map(warehouse => Number(warehouse.id)),
        hideQuantities,
        items: input.items,
      });
    }),

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
          includePendingQuantities: z.boolean().optional(),
          sortBy: z
            .enum([
              "sapItemCode",
              "name",
              "brand",
              "partNumber",
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
      return db.listInventoryItems(applyProjectScope(input ?? {}, ctx.user));
    }),

  pendingQuantities: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).max(200),
      })
    )
    .query(async ({ ctx, input }) => {
      assertCanReadInventory(ctx);
      return db.getInventoryPendingQuantitiesByItemIds(
        input.ids,
        applyProjectScope({}, ctx.user)
      );
    }),

  globalAvailability: protectedProcedure
    .input(
      z.object({
        search: z.string().trim().min(2).max(120),
        limit: z.number().int().min(1).max(150).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canReadGlobalAvailability(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a la consulta global de inventario",
        });
      }

      return db.searchGlobalInventoryAvailability(input);
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
      return db.getInventoryTracking(applyProjectScope(input, ctx.user));
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
      return db.getInventoryKardex(applyProjectScope(input, ctx.user));
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
