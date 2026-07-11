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
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "ingeniero_residente" ||
    user.buildreqRole === "superintendente" ||
    user.buildreqRole === "contable"
  );
}

function canManageArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canCreateArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
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

function assertCanCreateArticles(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canCreateArticles(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para crear artículos",
    });
  }
}

async function assertActiveFinancialGroup(
  financialGroupCode?: string | null
) {
  if (!financialGroupCode) return;

  const financialGroup = await db.getFinancialGroupByCode(financialGroupCode);
  if (!financialGroup || !financialGroup.isActive) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "El grupo financiero seleccionado no existe o está inactivo",
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
      return db.listArticles(input ?? {});
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        itemCode: z.string().trim().min(1).max(50).optional(),
        description: z.string().trim().min(1).max(500).optional(),
        itemGroup: z.string().trim().max(255).nullable().optional(),
        financialGroupCode: z.string().trim().max(20).nullable().optional(),
        brand: z.string().trim().max(120).nullable().optional(),
        partNumber: z.string().trim().max(120).nullable().optional(),
        tipoArticulo: articleTypeSchema,
        projectId: z.number().int().positive().nullable().optional(),
        isActive: z.boolean(),
        allowsTaxWithholding: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageArticles(ctx.user);
      if (input.itemCode) {
        const currentItemCode = await db.getArticleItemCode(input.id);
        if (!currentItemCode) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Artículo no encontrado",
          });
        }
        if (currentItemCode !== input.itemCode) {
          const duplicateArticleId = await db.getArticleIdByItemCode(
            input.itemCode
          );
          if (duplicateArticleId && duplicateArticleId !== input.id) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Ya existe un artículo con ese código",
            });
          }
          if (await db.articleCodeHasUsage(currentItemCode)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "El código SAP no puede cambiarse porque el artículo ya está utilizado. Cree el código correcto y desactive el anterior.",
            });
          }
        }
      }
      if (input.financialGroupCode) {
        const currentFinancialGroupCode =
          await db.getArticleFinancialGroupCode(input.id);
        if (currentFinancialGroupCode !== input.financialGroupCode) {
          await assertActiveFinancialGroup(input.financialGroupCode);
        }
      }
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

      const updateData: Parameters<typeof db.updateArticle>[1] = {
        itemCode: input.itemCode,
        description: input.description,
        itemGroup: input.itemGroup?.trim() || null,
        brand: input.brand?.trim() || null,
        partNumber: input.partNumber?.trim() || null,
        tipoArticulo: input.tipoArticulo,
        projectId,
        isActive: input.isActive,
        allowsTaxWithholding: input.allowsTaxWithholding,
        updatedById: ctx.user.id,
      };
      if ("financialGroupCode" in input) {
        updateData.financialGroupCode = input.financialGroupCode || null;
      }
      if (!("itemCode" in input)) {
        delete updateData.itemCode;
      }
      if (!("description" in input)) {
        delete updateData.description;
      }
      if (!("itemGroup" in input)) {
        delete updateData.itemGroup;
      }
      if (!("brand" in input)) {
        delete updateData.brand;
      }
      if (!("partNumber" in input)) {
        delete updateData.partNumber;
      }

      try {
        return await db.updateArticle(input.id, updateData);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo actualizar el artículo",
        });
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        itemCode: z.string().trim().min(1).max(50),
        description: z.string().trim().min(1).max(500),
        itemGroup: z.string().trim().max(255).nullable().optional(),
        financialGroupCode: z.string().trim().max(20).nullable().optional(),
        brand: z.string().trim().max(120).nullable().optional(),
        partNumber: z.string().trim().max(120).nullable().optional(),
        tipoArticulo: articleTypeSchema.default(1),
        projectId: z.number().int().positive().nullable().optional(),
        allowsTaxWithholding: z.boolean().default(true),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanCreateArticles(ctx.user);
      await assertActiveFinancialGroup(input.financialGroupCode);
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

      try {
        return await db.createArticle({
          itemCode: input.itemCode,
          description: input.description,
          itemGroup: input.itemGroup ?? null,
          financialGroupCode: input.financialGroupCode ?? null,
          brand: input.brand ?? null,
          partNumber: input.partNumber ?? null,
          tipoArticulo: input.tipoArticulo,
          projectId,
          allowsTaxWithholding: input.allowsTaxWithholding,
          isActive: input.isActive,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "No se pudo crear el artículo",
        });
      }
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
          updatedById: ctx.user.id,
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
        return await db.updateFixedAssetArticleDetails({
          ...input,
          updatedById: ctx.user.id,
        });
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
