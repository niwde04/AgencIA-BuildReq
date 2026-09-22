import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as notes from "../financialNotes";
import {
  NOTE_STATUSES,
  NOTE_TYPES,
  canManageNoteConcepts,
  canReadFinancialNotes,
  noteDraftSchema,
} from "../../shared/financial-notes";

const idSchema = z.object({ id: z.number().int().positive() });
const pageSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
  search: z.string().trim().max(200).optional(),
});
const conceptSchema = z.object({
  type: z.enum(NOTE_TYPES),
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform(s => s.toUpperCase()),
  description: z.string().trim().min(1).max(500),
  applicability: z.string().trim().max(2000).default(""),
  financialGroupCode: z.string().trim().max(20).nullish(),
  isActive: z.boolean(),
  allowsTaxOnly: z.boolean().default(false),
});

async function execute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const cause = (error as any)?.cause ?? error;
    if ((cause as any)?.code === "23505")
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Ya existe un concepto, consecutivo o documento fiscal con esa identificación",
      });
    if ((cause as any)?.code === "23503")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "El registro está relacionado con otros documentos; utilice desactivar o anular",
      });
    if ((cause as any)?.code === "40001" || (cause as any)?.code === "40P01")
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Otra operación modificó estos documentos; actualice e intente nuevamente",
      });
    if (
      error instanceof Error &&
      !(cause as any)?.code &&
      !error.message.includes("query:")
    )
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    console.error("[FinancialNotes] Operation failed", {
      code: (cause as any)?.code,
      message: (cause as any)?.message,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "No se pudo completar la operación de la nota. Intente nuevamente. Código: FN-SAVE",
    });
  }
}
function assertCatalog(
  user: Parameters<typeof canManageNoteConcepts>[0],
  write = false
) {
  if (write ? !canManageNoteConcepts(user) : !canReadFinancialNotes(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para este catálogo",
    });
}

export const noteConceptsRouter = router({
  listPage: protectedProcedure
    .input(
      pageSchema.extend({
        type: z.enum(NOTE_TYPES),
        isActive: z.boolean().optional(),
      })
    )
    .query(({ ctx, input }) => {
      assertCatalog(ctx.user);
      return execute(() => notes.listNoteConcepts(input));
    }),
  create: protectedProcedure.input(conceptSchema).mutation(({ ctx, input }) => {
    assertCatalog(ctx.user, true);
    return execute(() => notes.saveNoteConcept(input));
  }),
  update: protectedProcedure
    .input(conceptSchema.extend({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      assertCatalog(ctx.user, true);
      return execute(() => notes.saveNoteConcept(input, input.id));
    }),
  remove: protectedProcedure.input(idSchema).mutation(({ ctx, input }) => {
    assertCatalog(ctx.user, true);
    return execute(() => notes.removeNoteConcept(input.id));
  }),
});

export const financialNotesRouter = router({
  listPage: protectedProcedure
    .input(
      pageSchema.extend({
        type: z.enum(NOTE_TYPES),
        status: z.enum(NOTE_STATUSES).optional(),
        origin: z.enum(["manual", "retentions", "supplier_return"]).optional(),
        projectId: z.number().int().positive().optional(),
        supplierId: z.number().int().positive().optional(),
        invoiceId: z.number().int().positive().optional(),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
    )
    .query(({ ctx, input }) =>
      execute(() => notes.listFinancialNotes(input, ctx.user))
    ),
  getById: protectedProcedure
    .input(idSchema)
    .query(({ ctx, input }) =>
      execute(() => notes.getFinancialNote(input.id, ctx.user))
    ),
  eligibleInvoices: protectedProcedure
    .input(
      pageSchema.extend({
        type: z.enum(NOTE_TYPES),
        projectId: z.number().int().positive().optional(),
        supplierId: z.number().int().positive().optional(),
        currency: z.enum(["HNL", "USD"]).optional(),
      })
    )
    .query(({ ctx, input }) =>
      execute(() => notes.eligibleNoteInvoices(input, ctx.user))
    ),
  create: protectedProcedure
    .input(noteDraftSchema.extend({ requestKey: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      execute(() => notes.createFinancialNote(input, ctx.user))
    ),
  update: protectedProcedure
    .input(noteDraftSchema.extend({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      execute(() => notes.updateFinancialNote(input.id, input, ctx.user))
    ),
  review: protectedProcedure
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      execute(() =>
        notes.transitionFinancialNote(input.id, "review", undefined, ctx.user)
      )
    ),
  account: protectedProcedure
    .input(idSchema.extend({ comment: z.string().trim().max(2000).optional() }))
    .mutation(({ ctx, input }) =>
      execute(() =>
        notes.transitionFinancialNote(
          input.id,
          "account",
          input.comment,
          ctx.user
        )
      )
    ),
  reject: protectedProcedure
    .input(idSchema.extend({ comment: z.string().trim().min(5).max(2000) }))
    .mutation(({ ctx, input }) =>
      execute(() =>
        notes.transitionFinancialNote(
          input.id,
          "reject",
          input.comment,
          ctx.user
        )
      )
    ),
  void: protectedProcedure
    .input(idSchema.extend({ comment: z.string().trim().min(5).max(2000) }))
    .mutation(({ ctx, input }) =>
      execute(() =>
        notes.transitionFinancialNote(input.id, "void", input.comment, ctx.user)
      )
    ),
  remove: protectedProcedure
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      execute(() =>
        notes.transitionFinancialNote(input.id, "remove", undefined, ctx.user)
      )
    ),
  lookupFiscalRange: protectedProcedure
    .input(
      z.object({
        type: z.enum(NOTE_TYPES),
        supplierId: z.number().int().positive(),
        fiscalNumber: z.string().trim().min(1).max(100),
      })
    )
    .query(({ ctx, input }) =>
      execute(() => notes.lookupNoteFiscalRange(input, ctx.user))
    ),
});
