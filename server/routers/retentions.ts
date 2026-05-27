import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

function canReadRetentions(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    canManageRetentions(user) ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canManageRetentions(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return user.role === "admin" || user.buildreqRole === "contable";
}

function assertCanReadRetentions(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canReadRetentions(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para consultar retenciones",
    });
  }
}

function assertCanManageRetentions(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canManageRetentions(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para modificar retenciones",
    });
  }
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
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
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ingrese una tasa mayor que cero y menor o igual a 100",
      });
    }
  });

const retentionInputSchema = z.object({
  taxCode: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(200),
  ratePercent: rateSchema,
  isActive: z.boolean(),
  note: z.string().trim().max(1000).optional().nullable(),
  erpCode: z.string().trim().max(50).optional().nullable(),
});

export const retentionsRouter = router({
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
      assertCanReadRetentions(ctx.user);
      return db.listTaxRetentions(input ?? {});
    }),

  activeOptions: protectedProcedure.query(async () => {
    return db.listActiveTaxRetentions();
  }),

  create: protectedProcedure
    .input(retentionInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageRetentions(ctx.user);
      return db.createTaxRetention({
        taxCode: normalizeCode(input.taxCode),
        description: input.description.trim(),
        ratePercent: input.ratePercent,
        isActive: input.isActive,
        note: nullableText(input.note),
        erpCode: nullableText(input.erpCode)?.toUpperCase() ?? null,
      });
    }),

  update: protectedProcedure
    .input(
      retentionInputSchema.extend({
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageRetentions(ctx.user);
      return db.updateTaxRetention(input.id, {
        taxCode: normalizeCode(input.taxCode),
        description: input.description.trim(),
        ratePercent: input.ratePercent,
        isActive: input.isActive,
        note: nullableText(input.note),
        erpCode: nullableText(input.erpCode)?.toUpperCase() ?? null,
      });
    }),
});
