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
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function canEditInvoices(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
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

function assertInvoiceDraft(detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>) {
  if (detail.invoice.status !== "borrador") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Solo se pueden editar facturas en borrador",
    });
  }
}

function parseDateInput(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

const invoiceRetentionSchema = z
  .object({
    retentionType: z.enum(["percentage", "amount"]),
    description: z.string().trim().min(1).max(200),
    baseAmount: z.string().trim().optional(),
    percentage: z.string().trim().optional(),
    amount: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.retentionType === "percentage") {
      if (
        !value.percentage ||
        !Number.isFinite(Number(value.percentage)) ||
        Number(value.percentage) <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["percentage"],
          message: "Ingrese un porcentaje mayor que cero",
        });
      }
      if (
        value.baseAmount &&
        (!Number.isFinite(Number(value.baseAmount)) || Number(value.baseAmount) < 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseAmount"],
          message: "Ingrese una base válida",
        });
      }
    }

    if (
      value.retentionType === "amount" &&
      (!value.amount || !Number.isFinite(Number(value.amount)) || Number(value.amount) <= 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "Ingrese un monto mayor que cero",
      });
    }
  });

export const invoicesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          status: z.enum(["borrador", "registrada", "anulada"]).optional(),
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

      return db.listInvoices({
        ...input,
        projectId,
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
      return detail;
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          id: z.number(),
          cai: z.string().trim().max(100).optional(),
          invoiceNumber: z.string().trim().max(100).optional(),
          documentDate: z.string().optional(),
          postingDate: z.string(),
          receiptDate: z.string(),
          emissionDeadline: z.string(),
          notes: z.string().trim().max(2000).optional(),
        })
        .superRefine((value, ctx) => {
          if (!value.cai?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["cai"],
              message: "Ingrese el CAI de la factura",
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
              message: "Ingrese el número de factura",
            });
          } else if (!isValidInvoiceNumber(value.invoiceNumber)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["invoiceNumber"],
              message: `El número de factura debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
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

      return db.updateInvoice(input.id, {
        cai: input.cai ? formatCaiInput(input.cai) : null,
        invoiceNumber: input.invoiceNumber
          ? formatInvoiceNumberInput(input.invoiceNumber)
          : null,
        documentDate: parseDateInput(input.documentDate),
        postingDate: parseDateInput(input.postingDate) ?? new Date(),
        receiptDate: parseDateInput(input.receiptDate) ?? new Date(),
        emissionDeadline: parseDateInput(input.emissionDeadline) ?? new Date(),
        notes: input.notes?.trim() || null,
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
