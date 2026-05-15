import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

function canReadSuppliers(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function assertCanReadSuppliers(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canReadSuppliers(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al catálogo de proveedores",
    });
  }
}

export const suppliersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          isActive: z.boolean().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(200).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      assertCanReadSuppliers(ctx.user);
      return db.listSupplierCatalog(input ?? {});
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        allowsTaxWithholding: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanReadSuppliers(ctx.user);
      return db.updateSupplier(input.id, {
        allowsTaxWithholding: input.allowsTaxWithholding,
      });
    }),
});
