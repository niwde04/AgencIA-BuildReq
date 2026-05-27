import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import {
  CAI_FORMAT_EXAMPLE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  formatInvoiceNumberInput,
  isValidCai,
  isValidInvoiceNumber,
} from "@shared/invoices";

function canAccessInvoices(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "contable"
  );
}

function canEditInvoices(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canReviewInvoices(user: { role: string; buildreqRole?: string | null }) {
  return canEditInvoices(user);
}

function canAccountInvoices(user: { role: string; buildreqRole?: string | null }) {
  return user.role === "admin" || user.buildreqRole === "contable";
}

function canAccessReviewedInvoices(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "contable" ||
    user.buildreqRole === "administracion_central"
  );
}

function assertProjectScopedAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
  },
  projectId: number
) {
  if (user.role === "admin") return;
  if (
    user.buildreqRole !== "administrador_proyecto" &&
    user.buildreqRole !== "bodeguero_proyecto"
  ) {
    return;
  }
  if (user.assignedProjectId !== projectId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a facturas de otro proyecto",
    });
  }
}

function assertAccountingAccess(
  user: { role: string; buildreqRole?: string | null },
  detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>
) {
  const accountingVisibleStatuses = ["revisada", "registrada"];
  if (!accountingVisibleStatuses.includes(detail.invoice.status)) {
    if (user.buildreqRole !== "contable") return;
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Contabilidad solo puede ver facturas revisadas o contabilizadas",
    });
  }
  if (!canAccessReviewedInvoices(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Solo Contabilidad o Superusuario puede ver facturas revisadas o contabilizadas",
    });
  }
}

function assertInvoiceDraft(detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>) {
  if (
    detail.invoice.status !== "borrador" &&
    detail.invoice.status !== "rechazada"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Solo se pueden editar facturas en borrador o rechazadas",
    });
  }
}

function assertInvoiceReviewed(detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>) {
  if (detail.invoice.status !== "revisada") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Solo se pueden contabilizar o rechazar facturas revisadas",
    });
  }
}

function assertInvoiceReadyForReview(
  detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>
) {
  const invoice = detail.invoice;
  if (invoice.isFiscalDocument !== false) {
    if (!invoice.cai?.trim()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ingrese el CAI del documento antes de enviar a revisión",
      });
    }
    if (!isValidCai(invoice.cai)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`,
      });
    }
    if (!invoice.invoiceNumber?.trim()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ingrese el número documento antes de enviar a revisión",
      });
    }
    if (!isValidInvoiceNumber(invoice.invoiceNumber)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
      });
    }
    if (!invoice.documentDueDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Seleccione la fecha de vencimiento del documento antes de enviar a revisión",
      });
    }
  }
}

function parseDateInput(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

const invoiceRetentionSchema = z
  .object({
    invoiceItemId: z.number().int().positive().optional(),
    retentionCatalogId: z.number().int().positive(),
    baseAmount: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.baseAmount ||
      !Number.isFinite(Number(value.baseAmount)) ||
      Number(value.baseAmount) <= 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseAmount"],
        message: "Ingrese una base mayor que cero",
      });
    }
  });

export const invoicesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          status: z
            .enum(["borrador", "revisada", "rechazada", "registrada", "anulada"])
            .optional(),
          supplierId: z.number().optional(),
          search: z.string().trim().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a facturas",
        });
      }

      const projectId =
        ctx.user.buildreqRole === "administrador_proyecto" ||
        ctx.user.buildreqRole === "bodeguero_proyecto"
          ? ctx.user.assignedProjectId ?? -1
          : input?.projectId;
      const accountantStatuses = ["revisada", "registrada"];
      const status =
        ctx.user.buildreqRole === "contable" &&
        input?.status &&
        accountantStatuses.includes(input.status)
          ? input.status
          : ctx.user.buildreqRole === "contable"
            ? undefined
            : input?.status;
      const statuses =
        ctx.user.buildreqRole === "contable" && !status
          ? accountantStatuses
          : undefined;
      const excludeStatus =
        !canAccessReviewedInvoices(ctx.user) && status !== "revisada"
          ? "revisada"
          : undefined;
      if (!canAccessReviewedInvoices(ctx.user) && status === "revisada") {
        return [];
      }

      return db.listInvoices({
        ...input,
        projectId,
        status,
        statuses,
        excludeStatus,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a facturas",
        });
      }

      const detail = await db.getInvoiceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Factura no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.invoice.projectId);
      assertAccountingAccess(ctx.user, detail);
      return detail;
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          id: z.number(),
          isFiscalDocument: z.boolean().optional(),
          cai: z.string().trim().max(100).optional(),
          invoiceNumber: z.string().trim().max(100).optional(),
          documentDate: z.string().optional(),
          documentDueDate: z.string().optional(),
          postingDate: z.string(),
          receiptDate: z.string(),
          emissionDeadline: z.string().optional(),
          notes: z.string().trim().max(2000).optional(),
        })
        .superRefine((value, ctx) => {
          const requiresFiscalFormat = value.isFiscalDocument !== false;
          if (!requiresFiscalFormat) return;

          if (!value.cai?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["cai"],
              message: "Ingrese el CAI del documento",
            });
          } else if (!isValidCai(value.cai)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["cai"],
              message: `El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`,
            });
          }
          if (!value.invoiceNumber?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["invoiceNumber"],
              message: "Ingrese el número documento",
            });
          } else if (!isValidInvoiceNumber(value.invoiceNumber)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["invoiceNumber"],
              message: `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
            });
          }
          if (!value.documentDueDate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["documentDueDate"],
              message: "Seleccione la fecha de vencimiento del documento",
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canEditInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar facturas",
        });
      }

      const detail = await db.getInvoiceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Factura no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.invoice.projectId);
      assertInvoiceDraft(detail);

      const isFiscalDocument = input.isFiscalDocument !== false;

      return db.updateInvoice(input.id, {
        isFiscalDocument,
        cai: input.cai?.trim()
          ? isFiscalDocument
            ? formatCaiInput(input.cai)
            : input.cai.trim()
          : null,
        invoiceNumber: input.invoiceNumber
          ? isFiscalDocument
            ? formatInvoiceNumberInput(input.invoiceNumber)
            : input.invoiceNumber.trim()
          : null,
        documentDate: parseDateInput(input.documentDate),
        documentDueDate: parseDateInput(input.documentDueDate),
        postingDate: parseDateInput(input.postingDate) ?? new Date(),
        receiptDate: parseDateInput(input.receiptDate) ?? new Date(),
        emissionDeadline:
          parseDateInput(input.emissionDeadline) ??
          parseDateInput(input.postingDate) ??
          new Date(),
        notes: input.notes?.trim() || null,
      });
    }),

  review: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canReviewInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para revisar facturas",
        });
      }

      const detail = await db.getInvoiceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Factura no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.invoice.projectId);
      assertInvoiceDraft(detail);
      assertInvoiceReadyForReview(detail);

      const attachments = await db.getAttachmentsByEntity("invoice", input.id);
      if (attachments.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Adjunte al menos un archivo antes de enviar a revisión",
        });
      }

      return db.reviewInvoice(input.id, ctx.user.id);
    }),

  account: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        accountingComment: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccountInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Contabilidad o Superusuario puede contabilizar facturas",
        });
      }

      const detail = await db.getInvoiceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Factura no encontrada",
        });
      }
      assertInvoiceReviewed(detail);

      return db.accountInvoice({
        id: input.id,
        accountedById: ctx.user.id,
        accountingComment: input.accountingComment,
      });
    }),

  reject: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        rejectionComment: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccountInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Contabilidad o Superusuario puede rechazar facturas",
        });
      }

      const detail = await db.getInvoiceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Factura no encontrada",
        });
      }
      assertInvoiceReviewed(detail);

      return db.rejectInvoiceFromAccounting({
        id: input.id,
        rejectedById: ctx.user.id,
        rejectionComment: input.rejectionComment,
      });
    }),

  replaceRetentions: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        retentions: z.array(invoiceRetentionSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canEditInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar retenciones",
        });
      }

      const detail = await db.getInvoiceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Factura no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.invoice.projectId);
      assertInvoiceDraft(detail);

      try {
        return await db.replaceInvoiceRetentions(input.id, input.retentions);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudieron guardar las retenciones",
        });
      }
    }),
});
