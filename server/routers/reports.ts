import { TRPCError } from "@trpc/server";
import { buildDmcReportPayload, type DmcStatusMode } from "@shared/dmc-report";
import { buildDmcSarReportPayload } from "@shared/dmc-sar-report";
import {
  buildRetentionSarPayload,
  type RetentionSarType,
} from "@shared/retention-sar-report";
import { buildSystemWorkbookPayload } from "@shared/system-workbook-report";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { applyProjectScope } from "../projectAccess";

function canAccessReports(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "contable"
  );
}

function parseDateBoundary(
  value: string | null | undefined,
  boundary: "start" | "end"
) {
  if (!value) return null;
  const suffix = boundary === "start" ? "T00:00:00.000" : "T23:59:59.999";
  const date = new Date(`${value}${suffix}`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Fecha de reporte inválida",
    });
  }
  return date;
}

function getStatusFilters(statusMode: DmcStatusMode) {
  if (statusMode === "registered_only") {
    return { statuses: ["registrada"] };
  }
  if (statusMode === "non_void") {
    return { excludeStatus: "anulada" };
  }
  return {};
}

type DmcReportFilters = Parameters<typeof db.listDmcReportSourceInvoices>[0];

const dateInputSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

export const reportsRouter = router({
  systemWorkbook: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().nullish(),
        dateFrom: dateInputSchema,
        dateTo: dateInputSchema,
        statusMode: z
          .enum(["non_void", "registered_only", "all"])
          .default("non_void"),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReports(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a reportes",
        });
      }
      const dateFrom = parseDateBoundary(input.dateFrom, "start");
      const dateTo = parseDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }
      const invoiceFilters: DmcReportFilters = {
        dateFrom,
        dateTo,
        ...getStatusFilters(input.statusMode),
      };
      const purchaseOrderFilters: Parameters<
        typeof db.listSystemReportPurchaseOrderLines
      >[0] = { dateFrom, dateTo };
      const [sourceInvoices, purchaseOrderLines] = await Promise.all([
        db.listDmcReportSourceInvoices(
          applyProjectScope(invoiceFilters, ctx.user)
        ),
        db.listSystemReportPurchaseOrderLines(
          applyProjectScope(purchaseOrderFilters, ctx.user)
        ),
      ]);
      return buildSystemWorkbookPayload(sourceInvoices, purchaseOrderLines, {
        generatedAt: new Date(),
        dateFrom,
        dateTo,
        statusMode: input.statusMode,
      });
    }),
  systemPurchaseOrders: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().nullish(),
        dateFrom: dateInputSchema,
        dateTo: dateInputSchema,
        search: z.string().trim().max(200).nullish(),
        purchaseType: z.string().trim().max(50).nullish(),
        status: z.string().trim().max(50).nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReports(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a reportes",
        });
      }
      const dateFrom = parseDateBoundary(input.dateFrom, "start");
      const dateTo = parseDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }
      const purchaseOrderFilters: Parameters<
        typeof db.listSystemReportPurchaseOrderLines
      >[0] = {
        projectId: input.projectId,
        dateFrom,
        dateTo,
        search: input.search,
        purchaseType: input.purchaseType,
        statuses: input.status ? [input.status] : undefined,
      };
      const purchaseOrderLines = await db.listSystemReportPurchaseOrderLines(
        applyProjectScope(purchaseOrderFilters, ctx.user)
      );
      return buildSystemWorkbookPayload([], purchaseOrderLines, {
        generatedAt: new Date(),
        dateFrom,
        dateTo,
        statusMode: "all",
      });
    }),
  systemInvoices: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().nullish(),
        dateFrom: dateInputSchema,
        dateTo: dateInputSchema,
        search: z.string().trim().max(200).nullish(),
        status: z
          .enum(["borrador", "revisada", "rechazada", "registrada", "anulada"])
          .nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReports(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a reportes",
        });
      }
      const dateFrom = parseDateBoundary(input.dateFrom, "start");
      const dateTo = parseDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }
      const invoiceFilters: DmcReportFilters = {
        projectId: input.projectId,
        dateFrom,
        dateTo,
        search: input.search,
        ...(input.status
          ? { statuses: [input.status] }
          : { excludeStatus: "anulada" }),
      };
      const sourceInvoices = await db.listDmcReportSourceInvoices(
        applyProjectScope(invoiceFilters, ctx.user)
      );
      return buildSystemWorkbookPayload(sourceInvoices, [], {
        generatedAt: new Date(),
        dateFrom,
        dateTo,
        statusMode:
          input.status === "registrada"
            ? "registered_only"
            : input.status
              ? "all"
              : "non_void",
      });
    }),
  dmcPurchases: protectedProcedure
    .input(
      z.object({
        dateFrom: dateInputSchema,
        dateTo: dateInputSchema,
        statusMode: z
          .enum(["non_void", "registered_only", "all"])
          .default("non_void"),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReports(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a reportes",
        });
      }

      const dateFrom = parseDateBoundary(input.dateFrom, "start");
      const dateTo = parseDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }

      const filters: DmcReportFilters = {
        dateFrom,
        dateTo,
        ...getStatusFilters(input.statusMode),
      };
      const sourceInvoices = await db.listDmcReportSourceInvoices(
        applyProjectScope(filters, ctx.user)
      );

      return buildDmcReportPayload(sourceInvoices, {
        generatedAt: new Date(),
        source: "Base actual de BuildReq",
        dateFrom,
        dateTo,
        statusMode: input.statusMode,
      });
    }),
  dmcSarPurchases: protectedProcedure
    .input(
      z.object({
        dateFrom: dateInputSchema,
        dateTo: dateInputSchema,
        statusMode: z
          .enum(["non_void", "registered_only", "all"])
          .default("non_void"),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReports(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a reportes",
        });
      }

      const dateFrom = parseDateBoundary(input.dateFrom, "start");
      const dateTo = parseDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }

      const filters: DmcReportFilters = {
        dateFrom,
        dateTo,
        ...getStatusFilters(input.statusMode),
      };
      const sourceInvoices = await db.listDmcReportSourceInvoices(
        applyProjectScope(filters, ctx.user)
      );

      return buildDmcSarReportPayload(sourceInvoices, {
        generatedAt: new Date(),
        source: "Base actual de BuildReq",
        dateFrom,
        dateTo,
        statusMode: input.statusMode,
      });
    }),
  retentionSar: protectedProcedure
    .input(
      z.object({
        dateFrom: dateInputSchema,
        dateTo: dateInputSchema,
        statusMode: z
          .enum(["non_void", "registered_only", "all"])
          .default("non_void"),
        type: z.enum(["RT01", "RT125", "RT15"]),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReports(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a reportes",
        });
      }
      const dateFrom = parseDateBoundary(input.dateFrom, "start");
      const dateTo = parseDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }
      const filters: DmcReportFilters = {
        dateFrom,
        dateTo,
        ...getStatusFilters(input.statusMode),
      };
      const sourceInvoices = await db.listDmcReportSourceInvoices(
        applyProjectScope(filters, ctx.user)
      );
      return buildRetentionSarPayload(
        sourceInvoices,
        input.type as RetentionSarType,
        {
          generatedAt: new Date(),
          source: "Base actual de BuildReq",
          dateFrom,
          dateTo,
          statusMode: input.statusMode,
        }
      );
    }),
});
