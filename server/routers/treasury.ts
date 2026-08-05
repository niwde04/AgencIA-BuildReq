import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  TREASURY_BATCH_STATUS_CODES,
  TREASURY_PAYMENT_KIND_CODES,
  getTreasuryPaymentStatus,
  roundTreasuryMoney,
} from "@shared/treasury";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import { buildTreasuryInvoiceSummaryPayload } from "@shared/system-workbook-report";
import {
  applyProjectScope,
  canAccessProject,
  getProjectScopeIds,
} from "../projectAccess";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { buildTreasuryInvoiceReportPdfBase64 } from "../_core/documents";
import * as db from "../db";
import * as treasury from "../treasury";

type User = treasury.TreasuryActor;

const currencySchema = z.enum(["HNL", "USD"]);
const invoicePaymentReportStatusSchema = z.enum([
  "all",
  "paid",
  "pending",
  "partial",
]);
const reportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();
const invoiceReportSearchSchema = z.string().trim().max(200).nullish();
const invoiceSummaryReportInputSchema = z.object({
  paymentStatus: invoicePaymentReportStatusSchema,
  dateFrom: reportDateSchema,
  dateTo: reportDateSchema,
  search: invoiceReportSearchSchema,
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
const invoiceSummaryReportPdfInputSchema = invoiceSummaryReportInputSchema.omit(
  {
    page: true,
    pageSize: true,
  }
);
const draftItemSchema = z.union([
  z.object({
    sourceType: z.literal("invoice").optional(),
    invoiceId: z.number().int().positive(),
    requestedAmount: z.number().positive().max(999_999_999),
  }),
  z.object({
    sourceType: z.literal("purchase_order_advance"),
    purchaseOrderAdvanceId: z.number().int().positive(),
    requestedAmount: z.number().positive().max(999_999_999),
  }),
  z.object({
    sourceType: z.literal("quality_retention_release"),
    qualityRetentionReleaseId: z.number().int().positive(),
    requestedAmount: z.number().positive().max(999_999_999),
  }),
]);
const adjustmentSchema = z.object({
  itemId: z.number().int().positive(),
  amount: z.number().positive().max(999_999_999).optional(),
  excluded: z.boolean().optional(),
  reason: z.string().trim().max(2000).optional(),
});
const bankResponseAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  base64: z.string().min(1).max(15_000_000),
});

function isCentral(user: User) {
  return (
    user.role === "admin" || user.buildreqRole === "administracion_central"
  );
}

function isProjectManager(user: User) {
  return (
    user.role === "admin" || user.buildreqRole === "administrador_proyecto"
  );
}

function canManageTreasuryDrafts(user: User) {
  return isCentral(user) || isProjectManager(user);
}

function isAccountant(user: User) {
  return user.role === "admin" || user.buildreqRole === "contable";
}

async function canAccessTreasury(user: User) {
  return (
    isCentral(user) ||
    isProjectManager(user) ||
    isAccountant(user) ||
    user.buildreqRole === "financiero"
  );
}

async function assertTreasuryAccess(user: User) {
  if (!(await canAccessTreasury(user))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al módulo de Tesorería.",
    });
  }
}

async function assertTreasuryEnabled() {
  const settings = await treasury.getTreasurySettings();
  if (!settings.treasuryEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El módulo de Tesorería está deshabilitado.",
    });
  }
  return settings;
}

async function assertTreasuryBatchApprovalsEnabled() {
  const settings = await treasury.getTreasurySettings();
  if (!settings.treasuryBatchApprovalsEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Las aprobaciones de lotes de pago están desactivadas en Configuración.",
    });
  }
  return settings;
}

async function assertBatchAccess(user: User, batchId: number) {
  await assertTreasuryAccess(user);
  const detail = await treasury.getTreasuryBatchById(batchId);
  if (!detail) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lote no encontrado." });
  }
  const projectIds =
    detail.projectIds?.length > 0
      ? detail.projectIds
      : [detail.batch.projectId];
  if (!projectIds.every(projectId => canAccessProject(user, projectId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a uno o más proyectos de este lote.",
    });
  }
  return detail;
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Fecha inválida." });
  }
  return date;
}

function parseReportDateBoundary(
  value: string | null | undefined,
  boundary: "start" | "end"
) {
  if (!value) return null;
  const suffix = boundary === "start" ? "T00:00:00.000" : "T23:59:59.999";
  const date = new Date(`${value}${suffix}`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Fecha de reporte inválida.",
    });
  }
  return date;
}

function invoiceReportRowMatchesSearch(
  row: object,
  searchValue?: string | null
) {
  const term = String(searchValue ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-HN");
  if (!term) return true;
  return Object.values(row).some(value =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-HN")
      .includes(term)
  );
}

function formatTreasuryReportDate(value: unknown) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  const [year, month, day] = date.toISOString().slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatTreasuryReportDateTime(value: Date) {
  return value.toLocaleString("es-HN", {
    timeZone: "America/Tegucigalpa",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function buildTreasuryInvoiceSummaryReport(
  user: User,
  input: z.infer<typeof invoiceSummaryReportInputSchema>
) {
  const dateFrom = parseReportDateBoundary(input.dateFrom, "start");
  const dateTo = parseReportDateBoundary(input.dateTo, "end");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La fecha inicial no puede ser mayor que la fecha final.",
    });
  }
  const previewPage = input.page
    ? await treasury.listTreasuryInvoiceReportPage({
        paymentStatus: input.paymentStatus,
        search: input.search,
        dateFrom,
        dateTo,
        projectIds: getProjectScopeIds(user),
        page: input.page,
        pageSize: input.pageSize ?? 10,
      })
    : null;
  const invoiceFilters: Parameters<typeof db.listDmcReportSourceInvoices>[0] = {
    dateFrom,
    dateTo,
    statuses: ["registrada"],
    ...(previewPage ? { invoiceIds: previewPage.invoiceIds } : {}),
  };
  const sourceInvoices = await db.listDmcReportSourceInvoices(
    applyProjectScope(invoiceFilters, user)
  );
  const paymentsByInvoice = await treasury.getTreasuryInvoiceReportPayments(
    sourceInvoices.map(invoice => invoice.invoiceId)
  );
  const filteredInvoices = sourceInvoices.flatMap(invoice => {
    const payments = paymentsByInvoice.get(invoice.invoiceId) ?? [];
    const paidAmount = roundTreasuryMoney(
      payments.reduce((sum, payment) => sum + payment.amount, 0)
    );
    const treasuryPaymentStatus = getTreasuryPaymentStatus(
      Number(invoice.netPayable ?? 0),
      paidAmount + Number(invoice.appliedAdvanceAmount ?? 0)
    );
    const paymentStatus =
      treasuryPaymentStatus === "pagada"
        ? "paid"
        : treasuryPaymentStatus === "parcialmente_pagada"
          ? "partial"
          : "pending";
    if (
      input.paymentStatus !== "all" &&
      input.paymentStatus !== paymentStatus
    ) {
      return [];
    }
    return [
      {
        invoice,
        payments,
        paidAmount,
        paymentStatusLabel:
          paymentStatus === "paid"
            ? "Pagado"
            : paymentStatus === "partial"
              ? "Parcial"
              : "Pendiente",
      },
    ];
  });
  const payload = buildTreasuryInvoiceSummaryPayload(
    filteredInvoices.map(row => row.invoice),
    {
      generatedAt: new Date(),
      dateFrom,
      dateTo,
    }
  );
  payload.invoices.forEach((invoice, index) => {
    const reportInvoice = filteredInvoices[index]!;
    const paidDates = reportInvoice.payments
      .map(payment => payment.paidDate)
      .filter((date): date is Date => Boolean(date));
    invoice.Estado = reportInvoice.paymentStatusLabel;
    invoice["Lote de pago"] = Array.from(
      new Set(reportInvoice.payments.map(payment => payment.batchNumber))
    ).join(", ");
    invoice["Fecha de pago"] = paidDates.at(-1) ?? null;
    invoice["Referencia de pago"] = Array.from(
      new Set(
        reportInvoice.payments
          .map(payment => payment.bankReference?.trim())
          .filter((reference): reference is string => Boolean(reference))
      )
    ).join(", ");
    invoice["Monto pagado"] = reportInvoice.paidAmount;
    invoice.navigation.paymentBatches = Array.from(
      new Map(
        reportInvoice.payments.map(payment => [
          payment.batchId,
          {
            id: payment.batchId,
            batchNumber: payment.batchNumber,
          },
        ])
      ).values()
    );
  });
  const matchingInvoices = previewPage
    ? payload.invoices
    : payload.invoices.filter(invoice =>
        invoiceReportRowMatchesSearch(invoice, input.search)
      );
  const total = previewPage?.total ?? matchingInvoices.length;
  const page = previewPage?.page ?? 1;
  const pageSize = previewPage?.pageSize ?? Math.max(1, total);
  const totalPages = previewPage?.totalPages ?? 1;
  return {
    ...payload,
    invoices: matchingInvoices,
    summary: { ...payload.summary, invoiceCount: total },
    pagination: { page, pageSize, total, totalPages },
  };
}

function rethrowTreasuryError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof treasury.TreasuryApprovalsDisabledError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof treasury.TreasuryRuleError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  const databaseError = error as { code?: string; constraint?: string };
  if (
    databaseError?.code === "23505" &&
    (databaseError?.constraint === "treasury_item_active_invoice_unique" ||
      databaseError?.constraint === "treasury_item_active_advance_unique" ||
      databaseError?.constraint ===
        "treasury_item_active_quality_release_unique")
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        databaseError.constraint === "treasury_item_active_advance_unique"
          ? "Un anticipo seleccionado ya está reservado en otro lote activo."
          : databaseError.constraint ===
              "treasury_item_active_quality_release_unique"
            ? "Una liberación seleccionada ya está reservada en otro lote activo."
            : "Una factura seleccionada ya está reservada en otro lote activo.",
    });
  }
  throw error;
}

export const treasuryRouter = router({
  settings: protectedProcedure.query(async ({ ctx }) => ({
    ...(await treasury.getTreasurySettings()),
    canAccess: await canAccessTreasury(ctx.user),
    isApprover: ctx.user.buildreqRole === "financiero",
    permissions: {
      canCreate: canManageTreasuryDrafts(ctx.user),
      canDepurate: isCentral(ctx.user),
      canAccount: isAccountant(ctx.user),
    },
  })),

  updateSettings: adminProcedure
    .input(
      z
        .object({
          treasuryEnabled: z.boolean().optional(),
          treasuryBatchApprovalsEnabled: z.boolean().optional(),
        })
        .refine(
          input =>
            input.treasuryEnabled !== undefined ||
            input.treasuryBatchApprovalsEnabled !== undefined,
          "Indique al menos una configuración para actualizar."
        )
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await treasury.updateTreasurySettings({
          ...input,
          actor: ctx.user,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  approvers: adminProcedure.query(() => treasury.listTreasuryApprovers()),

  eligibleInvoices: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        currency: currencySchema.optional(),
        batchId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      if (input.projectId && !canAccessProject(ctx.user, input.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a facturas de ese proyecto.",
        });
      }
      if (input.batchId) {
        const detail = await assertBatchAccess(ctx.user, input.batchId);
        if (input.projectId && detail.batch.projectId !== input.projectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El lote no pertenece al proyecto solicitado.",
          });
        }
      }
      return treasury.listEligibleTreasuryInvoices({
        projectId: input.projectId,
        currency: input.currency,
        excludeBatchId: input.batchId,
        projectIds: input.projectId ? undefined : getProjectScopeIds(ctx.user),
      });
    }),

  eligibleAdvances: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        currency: currencySchema.optional(),
        batchId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      if (input.projectId && !canAccessProject(ctx.user, input.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a anticipos de ese proyecto.",
        });
      }
      if (input.batchId) {
        const detail = await assertBatchAccess(ctx.user, input.batchId);
        if (detail.batch.paymentKind !== "purchase_order_advance") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El lote solicitado no es un lote de anticipos.",
          });
        }
      }
      return treasury.listEligibleTreasuryAdvances({
        projectId: input.projectId,
        currency: input.currency,
        excludeBatchId: input.batchId,
        projectIds: input.projectId ? undefined : getProjectScopeIds(ctx.user),
      });
    }),

  eligibleQualityRetentionReleases: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        currency: currencySchema.optional(),
        batchId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      if (input.projectId && !canAccessProject(ctx.user, input.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a liberaciones de ese proyecto.",
        });
      }
      if (input.batchId) {
        const detail = await assertBatchAccess(ctx.user, input.batchId);
        if (detail.batch.paymentKind !== "quality_retention_release") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El lote solicitado no es de liberaciones de calidad.",
          });
        }
      }
      return treasury.listEligibleTreasuryQualityRetentionReleases({
        projectId: input.projectId,
        currency: input.currency,
        excludeBatchId: input.batchId,
        projectIds: input.projectId ? undefined : getProjectScopeIds(ctx.user),
      });
    }),

  invoiceSummaryReport: protectedProcedure
    .input(invoiceSummaryReportInputSchema)
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      return buildTreasuryInvoiceSummaryReport(ctx.user, input);
    }),

  invoiceSummaryReportPdf: protectedProcedure
    .input(invoiceSummaryReportPdfInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      const payload = await buildTreasuryInvoiceSummaryReport(ctx.user, input);
      if (!payload.summary.invoiceCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay facturas para exportar con los filtros actuales.",
        });
      }

      const statusLabel =
        input.paymentStatus === "paid"
          ? "Pagadas"
          : input.paymentStatus === "partial"
            ? "Parciales"
            : input.paymentStatus === "pending"
              ? "Pendientes"
              : "Todos los estados";
      const periodLabel =
        input.dateFrom || input.dateTo
          ? `${input.dateFrom ? formatTreasuryReportDate(input.dateFrom) : "Inicio"} - ${input.dateTo ? formatTreasuryReportDate(input.dateTo) : "Actualidad"}`
          : "Todas las fechas";
      const totalsByCurrency = new Map<
        "HNL" | "USD",
        { total: number; retentions: number; net: number }
      >();
      const rows = payload.invoices.map(invoice => {
        const currency = invoice.Moneda === "USD" ? "USD" : "HNL";
        const total = Number(invoice["Total factura"] ?? 0);
        const retentions =
          Number(invoice["Retenciones fiscales"] ?? 0) +
          Number(invoice["Otras retenciones"] ?? 0);
        const net = Number(invoice["Neto a pagar"] ?? 0);
        const accumulated = totalsByCurrency.get(currency) ?? {
          total: 0,
          retentions: 0,
          net: 0,
        };
        totalsByCurrency.set(currency, {
          total: roundTreasuryMoney(accumulated.total + total),
          retentions: roundTreasuryMoney(accumulated.retentions + retentions),
          net: roundTreasuryMoney(accumulated.net + net),
        });
        return {
          supplier: String(invoice.Proveedor || "-"),
          invoiceNumber: String(invoice["Nro. Factura"] || "-"),
          date: formatTreasuryReportDate(invoice["Fecha factura"]),
          total: formatPurchaseOrderCurrency(total, currency),
          retentions: formatPurchaseOrderCurrency(retentions, currency),
          net: formatPurchaseOrderCurrency(net, currency),
          status: String(invoice.Estado || "-"),
          document: String(invoice["Documento interno"] || "-"),
        };
      });
      const base64 = buildTreasuryInvoiceReportPdfBase64({
        generatedLabel: formatTreasuryReportDateTime(
          payload.summary.generatedAt
        ),
        statusLabel,
        periodLabel,
        searchLabel: input.search?.trim() || "Sin filtro",
        rows,
        totals: Array.from(totalsByCurrency.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, totals]) => ({
            currency,
            total: formatPurchaseOrderCurrency(totals.total, currency),
            retentions: formatPurchaseOrderCurrency(
              totals.retentions,
              currency
            ),
            net: formatPurchaseOrderCurrency(totals.net, currency),
          })),
      });

      return {
        fileName: `Tesoreria-Reporte-Facturas-${input.dateFrom || "inicio"}-${input.dateTo || "actualidad"}.pdf`,
        mimeType: "application/pdf" as const,
        base64,
        invoiceCount: payload.summary.invoiceCount,
      };
    }),

  list: protectedProcedure
    .input(
      z
        .object({ status: z.enum(TREASURY_BATCH_STATUS_CODES).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      return treasury.listTreasuryBatches({
        status: input?.status,
        projectIds: getProjectScopeIds(ctx.user),
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      return assertBatchAccess(ctx.user, input.id);
    }),

  paymentDetailReport: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      try {
        return await treasury.getTreasuryPaymentDetailReport(input.id);
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        currency: currencySchema,
        paymentKind: z.enum(TREASURY_PAYMENT_KIND_CODES).default("invoice"),
        requestedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(2000).optional(),
        items: z.array(draftItemSchema).min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      if (
        !canManageTreasuryDrafts(ctx.user) ||
        !canAccessProject(ctx.user, input.projectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Administración de Proyecto pueden crear lotes.",
        });
      }
      try {
        return await treasury.createTreasuryBatch({
          ...input,
          actor: ctx.user,
          requestedPaymentDate: parseDate(input.requestedPaymentDate),
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        requestedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(2000).optional(),
        items: z.array(draftItemSchema).min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      if (
        !canManageTreasuryDrafts(ctx.user) ||
        !canAccessProject(ctx.user, detail.batch.projectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede editar este lote.",
        });
      }
      try {
        return await treasury.updateTreasuryDraft({
          batchId: input.id,
          actor: ctx.user,
          requestedPaymentDate: parseDate(input.requestedPaymentDate),
          notes: input.notes,
          items: input.items,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  submit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      if (
        !canManageTreasuryDrafts(ctx.user) ||
        !canAccessProject(ctx.user, detail.batch.projectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede enviar este lote.",
        });
      }
      try {
        return await treasury.submitTreasuryBatch(input.id, ctx.user);
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  saveReview: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        adjustments: z.array(adjustmentSchema).max(500).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede revisar lotes.",
        });
      }
      await assertTreasuryBatchApprovalsEnabled();
      try {
        return await treasury.saveTreasuryReview({
          batchId: input.id,
          actor: ctx.user,
          adjustments: input.adjustments,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  consolidateForApproval: protectedProcedure
    .input(
      z.object({
        batchIds: z.array(z.number().int().positive()).min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede consolidar lotes.",
        });
      }
      for (const batchId of Array.from(new Set(input.batchIds))) {
        await assertBatchAccess(ctx.user, batchId);
      }
      try {
        return await treasury.consolidateTreasuryBatchesForApproval({
          batchIds: input.batchIds,
          actor: ctx.user,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      const approvedUser = ctx.user.buildreqRole === "financiero";
      if (!approvedUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el rol Financiero puede aprobar lotes de Tesorería.",
        });
      }
      await assertTreasuryBatchApprovalsEnabled();
      try {
        return await treasury.approveTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  reject: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (ctx.user.buildreqRole !== "financiero") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el rol Financiero puede rechazar lotes de Tesorería.",
        });
      }
      await assertTreasuryBatchApprovalsEnabled();
      try {
        return await treasury.rejectTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  returnBatch: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryBatchApprovalsEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      const allowed =
        detail.batch.status === "enviado_depuracion" && isCentral(ctx.user);
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede devolver este lote.",
        });
      }
      try {
        return await treasury.returnTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  exportBankWorkbook: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede exportar al banco.",
        });
      }
      try {
        return await treasury.exportTreasuryBankWorkbook(input.id, ctx.user);
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  recordBankResponse: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        bankReference: z.string().trim().min(1).max(255),
        paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        attachment: bankResponseAttachmentSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central puede registrar el pago bancario.",
        });
      }
      try {
        return await treasury.recordTreasuryBankResponse({
          batchId: input.id,
          actor: ctx.user,
          bankReference: input.bankReference,
          paidDate: parseDate(input.paidDate),
          attachment: input.attachment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  importBankWorkbook: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        fileName: z.string().trim().min(1).max(255),
        base64: z.string().min(1).max(15_000_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central puede importar la respuesta bancaria.",
        });
      }
      try {
        return await treasury.importTreasuryBankWorkbook({
          batchId: input.id,
          actor: ctx.user,
          fileName: input.fileName,
          base64: input.base64,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  resolveDifference: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        itemId: z.number().int().positive(),
        resolution: z.enum(["accept", "reject"]),
        comment: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede resolver diferencias.",
        });
      }
      try {
        return await treasury.resolveTreasuryDifference({
          batchId: input.id,
          itemId: input.itemId,
          actor: ctx.user,
          resolution: input.resolution,
          comment: input.comment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  accountItems: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
        comment: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isAccountant(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Contabilidad puede contabilizar abonos.",
        });
      }
      try {
        return await treasury.accountTreasuryItems({
          batchId: input.id,
          itemIds: input.itemIds,
          actor: ctx.user,
          comment: input.comment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  reopenRejected: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      const canReopen =
        isCentral(ctx.user) ||
        (settings.treasuryBatchApprovalsEnabled &&
          ctx.user.buildreqRole === "financiero");
      if (!canReopen) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central puede reabrir el lote con las aprobaciones desactivadas.",
        });
      }
      try {
        return await treasury.reopenRejectedTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  reopenClosed: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede reabrir lotes cerrados.",
        });
      }
      try {
        return await treasury.reopenClosedTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  cancel: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      const allowed =
        isCentral(ctx.user) ||
        (isProjectManager(ctx.user) &&
          canAccessProject(ctx.user, detail.batch.projectId) &&
          ["borrador", "devuelto"].includes(detail.batch.status));
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede anular este lote.",
        });
      }
      try {
        return await treasury.cancelTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),
});
