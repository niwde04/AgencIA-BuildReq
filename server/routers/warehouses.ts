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

export const warehousesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!canAccessWarehouses(ctx.user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene acceso a los almacenes",
      });
    }

    return db.listWarehouses({ isActive: true });
  }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        description: z.string().trim().max(1000).optional(),
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
