import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { ASSET_CONDITION_VALUES } from "@shared/fixed-assets";

const articleTypeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const fixedAssetDetailSchema = z.object({
  serialNumber: z.string().trim().min(1).max(120),
  condition: z.enum(ASSET_CONDITION_VALUES),
  color: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  chassisSeries: z.string().trim().max(120).nullish(),
  motorSeries: z.string().trim().max(120).nullish(),
  plateOrCode: z.string().trim().max(120).nullish(),
});

function canReadArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "contable"
  );
}

function canManageArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return user.role === "admin" || user.buildreqRole === "jefe_bodega_central";
}

function canResolveFixedAssetArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "contable"
  );
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
          fixedAssetStatus: z.enum(["pendiente", "resuelto"]).optional(),
          projectId: z.number().int().positive().optional(),
          temporaryOnly: z.boolean().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(200).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      assertCanReadArticles(ctx.user);
      const isContableOnly =
        ctx.user.buildreqRole === "contable" && ctx.user.role !== "admin";
      return db.listArticles({
        ...(input ?? {}),
        ...(isContableOnly
          ? {
              tipoArticulo: 3 as const,
              fixedAssetStatus: input?.fixedAssetStatus ?? "pendiente",
              temporaryOnly: true,
            }
          : {}),
      });
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

  resolveFixedAssetCode: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        itemCode: z.string().trim().min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canResolveFixedAssetArticles(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para resolver activos fijos",
        });
      }

      try {
        return await db.resolveFixedAssetArticleCode({
          id: input.id,
          itemCode: input.itemCode,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo resolver el activo fijo",
        });
      }
    }),

  updateFixedAssetDetails: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        isLeasing: z.boolean().optional(),
        observation: z.string().trim().max(1000).nullable().optional(),
        assetDetail: fixedAssetDetailSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canResolveFixedAssetArticles(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar datos del activo fijo",
        });
      }

      try {
        return await db.updateFixedAssetArticleDetails(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo actualizar el activo fijo",
        });
      }
    }),
});
