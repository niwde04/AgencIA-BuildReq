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
  isFiscalInvoiceRangeOrdered,
  isInvoiceNumberWithinFiscalRange,
  isValidInvoiceNumber,
} from "@shared/invoices";
import {
  ASSET_CONDITION_VALUES,
  normalizeFixedAssetDetails,
} from "@shared/fixed-assets";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function canAccessInvoices(user: {
  role: string;
  buildreqRole?: string | null;
}) {
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

function canReviewInvoices(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return canEditInvoices(user);
}

function canAccountInvoices(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return user.role === "admin" || user.buildreqRole === "contable";
}

function canAccessReviewedInvoices(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "contable" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function assertProjectScopedAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
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
  if (!canAccessProject(user, projectId)) {
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
  if (user.buildreqRole === "contable") return;
  const restrictedStatuses = ["revisada", "registrada"];
  if (!restrictedStatuses.includes(detail.invoice.status)) return;
  if (!canAccessReviewedInvoices(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Solo Contabilidad o Superusuario puede ver facturas revisadas o contabilizadas",
    });
  }
}

function assertInvoiceDraft(
  detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>
) {
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

function assertInvoiceReviewed(
  detail: NonNullable<Awaited<ReturnType<typeof db.getInvoiceById>>>
) {
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
    if (!invoice.documentRangeStart?.trim()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Ingrese el rango autorizado inicial antes de enviar a revisión",
      });
    }
    if (!isValidInvoiceNumber(invoice.documentRangeStart)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El rango autorizado inicial debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
      });
    }
    if (!invoice.documentRangeEnd?.trim()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ingrese el rango autorizado final antes de enviar a revisión",
      });
    }
    if (!isValidInvoiceNumber(invoice.documentRangeEnd)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El rango autorizado final debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
      });
    }
    if (
      !isFiscalInvoiceRangeOrdered({
        documentRangeStart: invoice.documentRangeStart,
        documentRangeEnd: invoice.documentRangeEnd,
      })
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El rango autorizado final debe ser mayor o igual al inicial",
      });
    }
    if (
      !isInvoiceNumberWithinFiscalRange({
        invoiceNumber: invoice.invoiceNumber,
        documentRangeStart: invoice.documentRangeStart,
        documentRangeEnd: invoice.documentRangeEnd,
      })
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El número documento debe estar dentro del rango autorizado",
      });
    }
    if (!invoice.documentDueDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Seleccione la fecha de vencimiento del documento antes de enviar a revisión",
      });
    }
    if (!invoice.emissionDeadline) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Seleccione la fecha límite de emisión antes de enviar a revisión",
      });
    }
  }
  if (
    (detail.retentions?.length ?? 0) > 0 &&
    !invoice.retentionReceiptNumber?.trim()
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Ingrese el número de comprobante de retención antes de enviar a revisión",
    });
  }
  if (
    invoice.isFiscalDocument !== false &&
    invoice.retentionReceiptNumber?.trim() &&
    !isValidInvoiceNumber(invoice.retentionReceiptNumber)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
    });
  }
}

function parseDateInput(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

function parseMoneyInput(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
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

const fixedAssetDetailSchema = z.object({
  serialNumber: z.string().trim().max(120),
  condition: z.enum(ASSET_CONDITION_VALUES),
  color: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  chassisSeries: z.string().trim().max(120).nullish(),
  motorSeries: z.string().trim().max(120).nullish(),
  plateOrCode: z.string().trim().max(120).nullish(),
});

const invoiceItemAssetSchema = z.object({
  id: z.number(),
  invoiceItemId: z.number().int().positive(),
  isFixedAsset: z.boolean(),
  isLeasing: z.boolean().optional(),
  lineObservation: z.string().trim().max(1000).optional(),
  assetDetails: z.array(fixedAssetDetailSchema).optional(),
});

export const invoicesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          status: z
            .enum([
              "borrador",
              "revisada",
              "rechazada",
              "registrada",
              "anulada",
            ])
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

      const status = input?.status;
      const excludeStatus =
        !canAccessReviewedInvoices(ctx.user) && status !== "revisada"
          ? "revisada"
          : undefined;
      if (!canAccessReviewedInvoices(ctx.user) && status === "revisada") {
        return [];
      }

      return db.listInvoices(
        applyProjectScope(
          {
            ...input,
            status,
            excludeStatus,
          },
          ctx.user
        )
      );
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

  lookupFiscalDocumentRange: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        invoiceNumber: z.string().trim().max(100),
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

      if (!isValidInvoiceNumber(input.invoiceNumber)) return null;

      const range = await db.lookupSupplierFiscalDocumentRange({
        invoiceId: input.id,
        invoiceNumber: formatInvoiceNumberInput(input.invoiceNumber),
      });
      if (!range) return null;

      return {
        cai: range.cai,
        documentRangeStart: range.documentRangeStart,
        documentRangeEnd: range.documentRangeEnd,
        emissionDeadline: range.emissionDeadline,
      };
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          id: z.number(),
          isFiscalDocument: z.boolean().optional(),
          cai: z.string().trim().max(100).optional(),
          invoiceNumber: z.string().trim().max(100).optional(),
          documentRangeStart: z.string().trim().max(100).optional(),
          documentRangeEnd: z.string().trim().max(100).optional(),
          documentDate: z.string().optional(),
          documentDueDate: z.string().optional(),
          postingDate: z.string(),
          receiptDate: z.string(),
          emissionDeadline: z.string().optional(),
          retentionReceiptNumber: z.string().trim().max(100).optional(),
          hasOceExemption: z.boolean().optional(),
          oceResolutionNumber: z.string().trim().max(100).optional(),
          oceResolutionDate: z.string().optional(),
          oceExemptAmount: z.string().trim().optional(),
          notes: z.string().trim().max(2000).optional(),
        })
        .superRefine((value, ctx) => {
          const hasOceExemption = value.hasOceExemption === true;
          const requiresFiscalFormat = value.isFiscalDocument !== false;

          if (requiresFiscalFormat) {
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
            if (!value.documentRangeStart?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeStart"],
                message: "Ingrese el rango autorizado inicial",
              });
            } else if (!isValidInvoiceNumber(value.documentRangeStart)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeStart"],
                message: `El rango autorizado inicial debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
              });
            }
            if (!value.documentRangeEnd?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeEnd"],
                message: "Ingrese el rango autorizado final",
              });
            } else if (!isValidInvoiceNumber(value.documentRangeEnd)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeEnd"],
                message: `El rango autorizado final debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
              });
            }
            if (
              value.documentRangeStart?.trim() &&
              value.documentRangeEnd?.trim() &&
              isValidInvoiceNumber(value.documentRangeStart) &&
              isValidInvoiceNumber(value.documentRangeEnd) &&
              !isFiscalInvoiceRangeOrdered({
                documentRangeStart: value.documentRangeStart,
                documentRangeEnd: value.documentRangeEnd,
              })
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeEnd"],
                message:
                  "El rango autorizado final debe ser mayor o igual al inicial",
              });
            }
            if (
              value.invoiceNumber?.trim() &&
              value.documentRangeStart?.trim() &&
              value.documentRangeEnd?.trim() &&
              isValidInvoiceNumber(value.invoiceNumber) &&
              isValidInvoiceNumber(value.documentRangeStart) &&
              isValidInvoiceNumber(value.documentRangeEnd) &&
              isFiscalInvoiceRangeOrdered({
                documentRangeStart: value.documentRangeStart,
                documentRangeEnd: value.documentRangeEnd,
              }) &&
              !isInvoiceNumberWithinFiscalRange({
                invoiceNumber: value.invoiceNumber,
                documentRangeStart: value.documentRangeStart,
                documentRangeEnd: value.documentRangeEnd,
              })
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["invoiceNumber"],
                message:
                  "El número documento debe estar dentro del rango autorizado",
              });
            }
            if (
              value.retentionReceiptNumber?.trim() &&
              !isValidInvoiceNumber(value.retentionReceiptNumber)
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["retentionReceiptNumber"],
                message: `El comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
              });
            }
            if (!value.documentDueDate) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentDueDate"],
                message: "Seleccione la fecha de vencimiento del documento",
              });
            }
            if (!value.emissionDeadline) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["emissionDeadline"],
                message: "Seleccione la fecha límite de emisión",
              });
            }
          }

          if (!hasOceExemption) return;

          if (!value.oceResolutionNumber?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["oceResolutionNumber"],
              message: "Ingrese el número de resolución OCE",
            });
          }
          if (!value.oceResolutionDate) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["oceResolutionDate"],
              message: "Seleccione la fecha de resolución OCE",
            });
          }
          const exemptAmount = parseMoneyInput(value.oceExemptAmount);
          if (!Number.isFinite(exemptAmount) || exemptAmount <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["oceExemptAmount"],
              message: "Ingrese un importe exento mayor que cero",
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
      const retentionReceiptNumber =
        input.retentionReceiptNumber?.trim() || null;
      const hasOceExemption = input.hasOceExemption === true;
      const oceExemptAmount = hasOceExemption
        ? parseMoneyInput(input.oceExemptAmount)
        : 0;
      if ((detail.retentions?.length ?? 0) > 0 && !retentionReceiptNumber) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Ingrese el número de comprobante de retención para esta factura",
        });
      }
      const invoiceSubtotal = parseMoneyInput(detail.invoice.subtotal);
      if (
        hasOceExemption &&
        Number.isFinite(invoiceSubtotal) &&
        oceExemptAmount > invoiceSubtotal + 0.0001
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El importe exento no puede exceder el subtotal de la factura",
        });
      }

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
        documentRangeStart: input.documentRangeStart
          ? isFiscalDocument
            ? formatInvoiceNumberInput(input.documentRangeStart)
            : input.documentRangeStart.trim()
          : null,
        documentRangeEnd: input.documentRangeEnd
          ? isFiscalDocument
            ? formatInvoiceNumberInput(input.documentRangeEnd)
            : input.documentRangeEnd.trim()
          : null,
        documentDate: parseDateInput(input.documentDate),
        documentDueDate: parseDateInput(input.documentDueDate),
        postingDate: parseDateInput(input.postingDate) ?? new Date(),
        receiptDate: parseDateInput(input.receiptDate) ?? new Date(),
        emissionDeadline:
          parseDateInput(input.emissionDeadline) ??
          parseDateInput(input.postingDate) ??
          new Date(),
        retentionReceiptNumber: retentionReceiptNumber
          ? isFiscalDocument
            ? formatInvoiceNumberInput(retentionReceiptNumber)
            : retentionReceiptNumber
          : null,
        hasOceExemption,
        oceResolutionNumber: hasOceExemption
          ? input.oceResolutionNumber?.trim() || null
          : null,
        oceResolutionDate: hasOceExemption
          ? parseDateInput(input.oceResolutionDate)
          : null,
        oceExemptAmount: hasOceExemption
          ? oceExemptAmount.toFixed(4)
          : "0.0000",
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
          message:
            "Solo Contabilidad o Superusuario puede contabilizar facturas",
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

  correctReceipt: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canEditInvoices(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para corregir recepciones",
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
      if (detail.invoice.status === "registrada") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede corregir una factura contabilizada",
        });
      }
      if (detail.invoice.status === "anulada") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La factura ya está anulada",
        });
      }
      if (
        !["borrador", "rechazada", "revisada"].includes(detail.invoice.status)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Esta factura no permite corrección de recepción",
        });
      }

      try {
        return await db.correctInvoiceReceiptFromInvoice({
          invoiceId: input.id,
          correctedById: ctx.user.id,
          reason: input.reason,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo corregir la recepción",
        });
      }
    }),

  replaceRetentions: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        retentions: z.array(invoiceRetentionSchema),
        retentionReceiptNumber: z.string().trim().max(100).optional(),
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
      if (
        input.retentions.length > 0 &&
        !(
          input.retentionReceiptNumber?.trim() ||
          detail.invoice.retentionReceiptNumber?.trim()
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Ingrese el número de comprobante de retención para guardar retenciones",
        });
      }
      const effectiveRetentionReceiptNumber =
        input.retentionReceiptNumber?.trim() ||
        detail.invoice.retentionReceiptNumber?.trim() ||
        "";
      if (
        detail.invoice.isFiscalDocument !== false &&
        effectiveRetentionReceiptNumber &&
        !isValidInvoiceNumber(effectiveRetentionReceiptNumber)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `El comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
        });
      }

      try {
        return await db.replaceInvoiceRetentions(
          input.id,
          input.retentions,
          input.retentionReceiptNumber
            ? detail.invoice.isFiscalDocument !== false
              ? formatInvoiceNumberInput(input.retentionReceiptNumber)
              : input.retentionReceiptNumber
            : undefined
        );
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

  updateItemAssetDetails: protectedProcedure
    .input(invoiceItemAssetSchema)
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

      const invoiceItem = detail.items.find(
        (item: any) => item.id === input.invoiceItemId
      );
      if (!invoiceItem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La línea de factura seleccionada no existe",
        });
      }

      const quantity = Number(invoiceItem.quantity);
      const isValidFixedAssetQuantity =
        Number.isFinite(quantity) && quantity > 0 && Number.isInteger(quantity);
      let assetDetails: ReturnType<typeof normalizeFixedAssetDetails> = [];
      if (input.isFixedAsset) {
        if (!isValidFixedAssetQuantity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Activo fijo requiere cantidad entera mayor que cero",
          });
        }
        if (invoiceItem.targetType !== "activo_fijo") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Solo se puede activar Activo fijo para productos clasificados como Activo Fijo",
          });
        }

        assetDetails = normalizeFixedAssetDetails(input.assetDetails, quantity);
        const missingRequiredIndex = assetDetails.findIndex(
          detail => !detail.serialNumber.trim() || !detail.condition
        );
        if (missingRequiredIndex >= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Complete número de serie y condición de la unidad ${
              missingRequiredIndex + 1
            }`,
          });
        }
      }

      return db.updateInvoiceItemAssetDetails(input.invoiceItemId, {
        isFixedAsset: input.isFixedAsset,
        isLeasing: input.isFixedAsset ? input.isLeasing === true : false,
        assetDetails,
        lineObservation: input.lineObservation?.trim() || null,
      });
    }),
});
