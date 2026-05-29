import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { parsePurchaseOrderAdditionalTaxCodes } from "@shared/purchase-orders";

function canReadTaxes(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    canManageTaxes(user) ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function canManageTaxes(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "contable"
  );
}

function assertCanReadTaxes(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canReadTaxes(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para consultar impuestos",
    });
  }
}

function assertCanManageTaxes(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canManageTaxes(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para modificar impuestos",
    });
  }
}

function nullableText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

const rateSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ingrese una tasa entre 0 y 100",
      });
    }
  });

const taxInputSchema = z.object({
  taxCode: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(200),
  shortLabel: z.string().trim().min(1).max(80),
  ratePercent: rateSchema,
  taxType: z.enum(["base", "additional"]),
  fiscalCategory: z.enum(["exento", "exonerado", "gravado"]),
  isActive: z.boolean(),
  displayOrder: z.number().int().min(0).max(10000),
  appliesToTaxCodes: z.array(z.string().trim().min(1)).optional(),
  note: z.string().trim().max(1000).optional().nullable(),
  erpCode: z.string().trim().max(50).optional().nullable(),
});

export const taxesRouter = router({
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
      assertCanReadTaxes(ctx.user);
      return db.listSalesTaxes(input ?? {});
    }),

  activeOptions: protectedProcedure.query(async ({ ctx }) => {
    assertCanReadTaxes(ctx.user);
    return db.listActiveSalesTaxes();
  }),

  create: protectedProcedure
    .input(taxInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageTaxes(ctx.user);
      return db.createSalesTax({
        taxCode: input.taxCode,
        description: input.description.trim(),
        shortLabel: input.shortLabel.trim(),
        ratePercent: input.ratePercent,
        taxType: input.taxType,
        fiscalCategory: input.fiscalCategory,
        isActive: input.isActive,
        displayOrder: input.displayOrder,
        appliesToTaxCodes:
          input.taxType === "additional"
            ? parsePurchaseOrderAdditionalTaxCodes(input.appliesToTaxCodes ?? [])
            : [],
        note: nullableText(input.note),
        erpCode: nullableText(input.erpCode)?.toUpperCase() ?? null,
      });
    }),

  update: protectedProcedure
    .input(taxInputSchema.extend({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManageTaxes(ctx.user);
      return db.updateSalesTax(input.id, {
        taxCode: input.taxCode,
        description: input.description.trim(),
        shortLabel: input.shortLabel.trim(),
        ratePercent: input.ratePercent,
        taxType: input.taxType,
        fiscalCategory: input.fiscalCategory,
        isActive: input.isActive,
        displayOrder: input.displayOrder,
        appliesToTaxCodes:
          input.taxType === "additional"
            ? parsePurchaseOrderAdditionalTaxCodes(input.appliesToTaxCodes ?? [])
            : [],
        note: nullableText(input.note),
        erpCode: nullableText(input.erpCode)?.toUpperCase() ?? null,
      });
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManageTaxes(ctx.user);
      return db.removeSalesTax(input.id);
    }),
});
