import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  listRetentionDocuments,
  getRetentionDocument,
  resolveLegacyRetention,
  retentionAttachmentUrl,
} from "../retentionDocuments";
const id = z.number().int().positive();
const text = z.string().trim().max(200).optional();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
export const retentionDocumentsRouter = router({
  listPage: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(25),
        search: text,
        supplierSearch: text,
        projectSearch: text,
        invoiceSearch: text,
        status: z.enum(["registrada", "historico", "anulada"]).optional(),
        supplierId: id.optional(),
        projectId: id.optional(),
        invoiceId: id.optional(),
        dateFrom: date,
        dateTo: date,
      })
    )
    .query(({ ctx, input }) => listRetentionDocuments(input, ctx.user)),
  getById: protectedProcedure
    .input(z.object({ id }))
    .query(({ ctx, input }) => getRetentionDocument(input.id, ctx.user)),
  resolveLegacy: protectedProcedure
    .input(z.object({ id }))
    .query(({ ctx, input }) => resolveLegacyRetention(input.id, ctx.user)),
  attachmentUrl: protectedProcedure
    .input(z.object({ documentId: id, attachmentId: id }))
    .query(({ ctx, input }) =>
      retentionAttachmentUrl(input.documentId, input.attachmentId, ctx.user)
    ),
});
