import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

function canReadArticleCatalog(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "ingeniero_residente" ||
    user.buildreqRole === "superintendente" ||
    user.buildreqRole === "contable"
  );
}

function canManageFinancialGroups(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" || user.buildreqRole === "administracion_central"
  );
}

function assertCanReadArticleCatalog(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canReadArticleCatalog(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al catálogo de artículos",
    });
  }
}

function assertCanManageFinancialGroups(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canManageFinancialGroups(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para modificar grupos financieros",
    });
  }
}

const financialGroupFields = z.object({
  financialGroupDescription: z.string().trim().min(1).max(500),
  codN2: z.string().trim().min(1).max(20),
  nivel2: z.string().trim().min(1).max(255),
  isActive: z.boolean(),
});

function toBadRequest(error: unknown, fallback: string) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : fallback,
  });
}

export const financialGroupsRouter = router({
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
      assertCanManageFinancialGroups(ctx.user);
      return db.listFinancialGroups(input ?? {});
    }),

  activeOptions: protectedProcedure.query(async ({ ctx }) => {
    assertCanReadArticleCatalog(ctx.user);
    return db.listActiveFinancialGroups();
  }),

  create: protectedProcedure
    .input(
      financialGroupFields.extend({
        financialGroupCode: z.string().trim().min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageFinancialGroups(ctx.user);
      try {
        return await db.createFinancialGroup(input);
      } catch (error) {
        throw toBadRequest(error, "No se pudo crear el grupo financiero");
      }
    }),

  update: protectedProcedure
    .input(
      financialGroupFields.extend({
        financialGroupCode: z.string().trim().min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageFinancialGroups(ctx.user);
      const { financialGroupCode, ...data } = input;
      try {
        return await db.updateFinancialGroup(financialGroupCode, data);
      } catch (error) {
        throw toBadRequest(error, "No se pudo actualizar el grupo financiero");
      }
    }),

  remove: protectedProcedure
    .input(
      z.object({
        financialGroupCode: z.string().trim().min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageFinancialGroups(ctx.user);
      try {
        return await db.removeFinancialGroup(input.financialGroupCode);
      } catch (error) {
        throw toBadRequest(error, "No se pudo eliminar el grupo financiero");
      }
    }),
});
