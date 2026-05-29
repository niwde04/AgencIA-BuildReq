import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

function canAccessWarehouses(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canReadProjectWarehouses(user: {
  role: string;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
}, projectId?: number) {
  if (canAccessWarehouses(user)) return true;
  if (
    (user.buildreqRole === "administrador_proyecto" ||
      user.buildreqRole === "bodeguero_proyecto") &&
    projectId &&
    user.assignedProjectId === projectId
  ) {
    return true;
  }
  return false;
}

export const warehousesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().int().positive().optional(),
          isActive: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
    if (!canReadProjectWarehouses(ctx.user, input?.projectId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene acceso a los almacenes",
      });
    }

    const projectId =
      ctx.user.buildreqRole === "administrador_proyecto" ||
      ctx.user.buildreqRole === "bodeguero_proyecto"
        ? ctx.user.assignedProjectId ?? -1
        : input?.projectId;

    return db.listWarehouses({
      isActive: input?.isActive ?? true,
      projectId,
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const detail = await db.getWarehouseDetailById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Almacén no encontrado",
        });
      }
      if (!canReadProjectWarehouses(ctx.user, detail.projectId ?? undefined)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a este almacén",
        });
      }
      return detail;
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        localCode: z.string().trim().min(1).max(20).optional(),
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(1000).optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessWarehouses(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para gestionar almacenes",
        });
      }

      return db.createWarehouse(input);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        localCode: z.string().trim().min(1).max(20).optional(),
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessWarehouses(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para gestionar almacenes",
        });
      }

      const { id, ...data } = input;
      return db.updateWarehouse(id, data);
    }),

  setDefault: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessWarehouses(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para gestionar almacenes",
        });
      }

      return db.setProjectDefaultWarehouse(input.id);
    }),

  deactivate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessWarehouses(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para gestionar almacenes",
        });
      }

      return db.updateWarehouse(input.id, { isActive: false });
    }),

  reactivate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessWarehouses(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para gestionar almacenes",
        });
      }

      return db.updateWarehouse(input.id, { isActive: true });
    }),

  seedDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    if (!canAccessWarehouses(ctx.user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene permisos para gestionar almacenes",
      });
    }

    return db.seedDefaultWarehouses();
  }),
});
