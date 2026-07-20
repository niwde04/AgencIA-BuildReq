import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { listInvoicesPage } from "../paginatedLists";
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

function rethrowDuplicateSupplierFiscalInvoice(error: unknown): never {
  if (db.isDuplicateSupplierFiscalInvoiceError(error)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: db.DUPLICATE_SUPPLIER_FISCAL_INVOICE_MESSAGE,
    });
  }
  throw error;
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
  if ((detail.retentions?.length ?? 0) > 0) {
    assertRetentionFiscalData(invoice, true);
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

type RetentionFiscalDataInput = {
  retentionReceiptNumber?: string | null;
  retentionCai?: string | null;
  retentionDocumentRangeStart?: string | null;
  retentionDocumentRangeEnd?: string | null;
  retentionEmissionDeadline?: string | Date | null;
};

function assertRetentionFiscalData(
  value: RetentionFiscalDataInput,
  required: boolean
) {
  const receiptNumber = value.retentionReceiptNumber?.trim() ?? "";
  const cai = value.retentionCai?.trim() ?? "";
  const rangeStart = value.retentionDocumentRangeStart?.trim() ?? "";
  const rangeEnd = value.retentionDocumentRangeEnd?.trim() ?? "";

  if (required && !receiptNumber) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ingrese el número de comprobante de retención",
    });
  }
  if (receiptNumber && !isValidInvoiceNumber(receiptNumber)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
    });
  }
  if (required && !cai) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ingrese el CAI del comprobante de retención",
    });
  }
  if (cai && !isValidCai(cai)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El CAI del comprobante de retención debe tener el formato ${CAI_FORMAT_EXAMPLE}`,
    });
  }
  if (required && !rangeStart) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ingrese el rango autorizado inicial del comprobante de retención",
    });
  }
  if (rangeStart && !isValidInvoiceNumber(rangeStart)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El rango inicial del comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
    });
  }
  if (required && !rangeEnd) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ingrese el rango autorizado final del comprobante de retención",
    });
  }
  if (rangeEnd && !isValidInvoiceNumber(rangeEnd)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El rango final del comprobante de retención debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
    });
  }
  if (
    rangeStart &&
    rangeEnd &&
    isValidInvoiceNumber(rangeStart) &&
    isValidInvoiceNumber(rangeEnd) &&
    !isFiscalInvoiceRangeOrdered({
      documentRangeStart: rangeStart,
      documentRangeEnd: rangeEnd,
    })
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "El rango final del comprobante de retención debe ser mayor o igual al inicial",
    });
  }
  if (
    receiptNumber &&
    rangeStart &&
    rangeEnd &&
    isValidInvoiceNumber(receiptNumber) &&
    isValidInvoiceNumber(rangeStart) &&
    isValidInvoiceNumber(rangeEnd) &&
    isFiscalInvoiceRangeOrdered({
      documentRangeStart: rangeStart,
      documentRangeEnd: rangeEnd,
    }) &&
    !isInvoiceNumberWithinFiscalRange({
      invoiceNumber: receiptNumber,
      documentRangeStart: rangeStart,
      documentRangeEnd: rangeEnd,
    })
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "El comprobante de retención debe estar dentro del rango autorizado",
    });
  }
  if (required && !value.retentionEmissionDeadline) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Seleccione la fecha límite de emisión del comprobante de retención",
    });
  }
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
  listPage: protectedProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        status: z
          .enum(["borrador", "revisada", "rechazada", "registrada", "anulada"])
          .optional(),
        supplierId: z.number().optional(),
        search: z.string().trim().optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(10).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessInvoices(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a facturas" });
      }
      const status = input.status;
      const excludeStatus =
        !canAccessReviewedInvoices(ctx.user) && status !== "revisada"
          ? "revisada"
          : undefined;
      if (!canAccessReviewedInvoices(ctx.user) && status === "revisada") {
        return {
          items: [],
          total: 0,
          page: 1,
          pageSize: input.pageSize ?? 50,
          totalPages: 1,
        };
      }
      return listInvoicesPage(
        applyProjectScope({ ...input, status, excludeStatus }, ctx.user)
      );
    }),

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
          retentionCai: z.string().trim().max(100).optional(),
          retentionDocumentRangeStart: z.string().trim().max(100).optional(),
          retentionDocumentRangeEnd: z.string().trim().max(100).optional(),
          retentionEmissionDeadline: z.string().optional(),
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
      const hasRetentions = (detail.retentions?.length ?? 0) > 0;
      const retentionFiscalData: RetentionFiscalDataInput = {
        retentionReceiptNumber: hasRetentions
          ? retentionReceiptNumber || detail.invoice.retentionReceiptNumber
          : retentionReceiptNumber,
        retentionCai: hasRetentions
          ? input.retentionCai?.trim() || detail.invoice.retentionCai
          : input.retentionCai?.trim() || null,
        retentionDocumentRangeStart: hasRetentions
          ? input.retentionDocumentRangeStart?.trim() ||
            detail.invoice.retentionDocumentRangeStart
          : input.retentionDocumentRangeStart?.trim() || null,
        retentionDocumentRangeEnd: hasRetentions
          ? input.retentionDocumentRangeEnd?.trim() ||
            detail.invoice.retentionDocumentRangeEnd
          : input.retentionDocumentRangeEnd?.trim() || null,
        retentionEmissionDeadline: hasRetentions
          ? input.retentionEmissionDeadline ||
            detail.invoice.retentionEmissionDeadline
          : input.retentionEmissionDeadline || null,
      };
      assertRetentionFiscalData(retentionFiscalData, hasRetentions);
      const hasOceExemption = input.hasOceExemption === true;
      const oceExemptAmount = hasOceExemption
        ? parseMoneyInput(input.oceExemptAmount)
        : 0;
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

      const updateData = {
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
        retentionReceiptNumber: retentionFiscalData.retentionReceiptNumber
          ? formatInvoiceNumberInput(retentionFiscalData.retentionReceiptNumber)
          : null,
        retentionCai: retentionFiscalData.retentionCai
          ? formatCaiInput(retentionFiscalData.retentionCai)
          : null,
        retentionDocumentRangeStart:
          retentionFiscalData.retentionDocumentRangeStart
            ? formatInvoiceNumberInput(
                retentionFiscalData.retentionDocumentRangeStart
              )
            : null,
        retentionDocumentRangeEnd: retentionFiscalData.retentionDocumentRangeEnd
          ? formatInvoiceNumberInput(retentionFiscalData.retentionDocumentRangeEnd)
          : null,
        retentionEmissionDeadline: parseDateInput(
          typeof retentionFiscalData.retentionEmissionDeadline === "string"
            ? retentionFiscalData.retentionEmissionDeadline
            : null
        ) ??
          (retentionFiscalData.retentionEmissionDeadline instanceof Date
            ? retentionFiscalData.retentionEmissionDeadline
            : null),
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
      };

      try {
        return await db.updateInvoice(input.id, updateData);
      } catch (error) {
        rethrowDuplicateSupplierFiscalInvoice(error);
      }
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
        retentionCai: z.string().trim().max(100).optional(),
        retentionDocumentRangeStart: z.string().trim().max(100).optional(),
        retentionDocumentRangeEnd: z.string().trim().max(100).optional(),
        retentionEmissionDeadline: z.string().optional(),
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
      const effectiveRetentionFiscalData: RetentionFiscalDataInput = {
        retentionReceiptNumber:
          input.retentionReceiptNumber?.trim() ||
          detail.invoice.retentionReceiptNumber,
        retentionCai:
          input.retentionCai?.trim() || detail.invoice.retentionCai,
        retentionDocumentRangeStart:
          input.retentionDocumentRangeStart?.trim() ||
          detail.invoice.retentionDocumentRangeStart,
        retentionDocumentRangeEnd:
          input.retentionDocumentRangeEnd?.trim() ||
          detail.invoice.retentionDocumentRangeEnd,
        retentionEmissionDeadline:
          input.retentionEmissionDeadline ||
          detail.invoice.retentionEmissionDeadline,
      };
      assertRetentionFiscalData(
        effectiveRetentionFiscalData,
        input.retentions.length > 0
      );
      const hasRetentionFiscalInput =
        input.retentionCai !== undefined ||
        input.retentionDocumentRangeStart !== undefined ||
        input.retentionDocumentRangeEnd !== undefined ||
        input.retentionEmissionDeadline !== undefined;

      try {
        const formattedRetentionReceiptNumber = input.retentionReceiptNumber
          ? formatInvoiceNumberInput(input.retentionReceiptNumber)
          : undefined;
        if (input.retentions.length === 0 || !hasRetentionFiscalInput) {
          return await db.replaceInvoiceRetentions(
            input.id,
            input.retentions,
            formattedRetentionReceiptNumber
          );
        }

        return await db.replaceInvoiceRetentions(
          input.id,
          input.retentions,
          formattedRetentionReceiptNumber,
          {
            retentionCai: effectiveRetentionFiscalData.retentionCai
              ? formatCaiInput(effectiveRetentionFiscalData.retentionCai)
              : null,
            retentionDocumentRangeStart:
              effectiveRetentionFiscalData.retentionDocumentRangeStart
                ? formatInvoiceNumberInput(
                    effectiveRetentionFiscalData.retentionDocumentRangeStart
                  )
                : null,
            retentionDocumentRangeEnd:
              effectiveRetentionFiscalData.retentionDocumentRangeEnd
                ? formatInvoiceNumberInput(
                    effectiveRetentionFiscalData.retentionDocumentRangeEnd
                  )
                : null,
            retentionEmissionDeadline: parseDateInput(
              typeof effectiveRetentionFiscalData.retentionEmissionDeadline ===
                "string"
                ? effectiveRetentionFiscalData.retentionEmissionDeadline
                : null
            ) ??
              (effectiveRetentionFiscalData.retentionEmissionDeadline instanceof
              Date
                ? effectiveRetentionFiscalData.retentionEmissionDeadline
                : null),
          }
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
