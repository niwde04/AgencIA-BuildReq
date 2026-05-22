import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

const articleTypeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

function canReadArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canManageArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return user.role === "admin" || user.buildreqRole === "jefe_bodega_central";
}

function assertCanReadArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canReadArticles(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al catálogo de artículos",
    });
  }
}

function assertCanManageArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canManageArticles(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para modificar artículos",
    });
  }
}

export const articlesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          tipoArticulo: articleTypeSchema.optional(),
          isActive: z.boolean().optional(),
          allowsTaxWithholding: z.boolean().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(200).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      assertCanReadArticles(ctx.user);
      return db.listArticles(input ?? {});
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        tipoArticulo: articleTypeSchema,
        projectId: z.number().int().positive().nullable().optional(),
        isActive: z.boolean(),
        allowsTaxWithholding: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageArticles(ctx.user);
      const projectId = input.tipoArticulo === 3 ? input.projectId ?? null : null;

      if (projectId) {
        const project = await db.getProjectById(projectId);
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Proyecto no encontrado",
          });
        }
      }

      return db.updateArticle(input.id, {
        tipoArticulo: input.tipoArticulo,
        projectId,
        isActive: input.isActive,
        allowsTaxWithholding: input.allowsTaxWithholding,
      });
    }),
});
