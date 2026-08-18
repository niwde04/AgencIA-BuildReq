import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  procurementProcedure as protectedProcedure,
  router,
} from "../_core/trpc";
import * as db from "../db";
import { getProjectScopeIds, hasAllProjectAccess } from "../projectAccess";
import { isProcurementApproverRole } from "@shared/buildreq-roles";
import {
  isPurchaseOrderApprovalEnabled,
  isPurchaseRequestApprovalEnabled,
} from "@shared/procurement-approvals";

const dashboardDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

function parseDashboardDateBoundary(
  value: string | undefined,
  boundary: "start" | "end"
) {
  if (!value) return null;
  const suffix = boundary === "start" ? "T00:00:00.000" : "T23:59:59.999";
  const date = new Date(`${value}${suffix}`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Fecha de informe inválida",
    });
  }
  return date;
}

export const dashboardRouter = router({
  stats: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const userRole = user.buildreqRole;
    if (userRole === "contable") {
      return {
        totalRequests: 0,
        totalActiveProjects: 0,
        totalReturns: 0,
        pendingReturns: 0,
        requestsByStatus: [],
        requestsByProject: [],
        requestsByFlow: [],
        recentRequests: [],
      };
    }
    const scopedProjectIds = getProjectScopeIds(user);

    return db.getDashboardStats({
      ...(userRole === "ingeniero_residente" ? { requestedById: user.id } : {}),
      ...(scopedProjectIds !== undefined
        ? { projectIds: scopedProjectIds }
        : {}),
    });
  }),

  financialReport: protectedProcedure
    .input(
      z.object({
        dateFrom: dashboardDateSchema,
        dateTo: dashboardDateSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const dateFrom = parseDashboardDateBoundary(input.dateFrom, "start");
      const dateTo = parseDashboardDateBoundary(input.dateTo, "end");
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha inicial no puede ser mayor que la fecha final",
        });
      }
      const scopedProjectIds = getProjectScopeIds(ctx.user);
      return db.getDashboardFinancialReport({
        ...(scopedProjectIds !== undefined
          ? { projectIds: scopedProjectIds }
          : {}),
        dateFrom,
        dateTo,
      });
    }),

  sidebarCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const userRole = user.buildreqRole;
    if (userRole === "contable") {
      return db.getDashboardSidebarCounts({
        includeMaterialRequests: false,
        includeSupplyFlows: false,
        includePurchaseRequests: false,
        purchaseRequestStatus: "pendiente",
        includePurchaseOrders: false,
        purchaseOrderStatus: "emitida",
        includeTransferRequests: false,
        includeFixedAssets: true,
        includeInvoices: false,
        includeReviewedInvoices: true,
      });
    }
    const isAdmin = user.role === "admin";
    const scopedProjectIds = getProjectScopeIds(user);
    const purchaseProjectIds =
      userRole === "administrador_proyecto" && hasAllProjectAccess(user)
        ? undefined
        : scopedProjectIds;
    const canAccessProcurement =
      isAdmin ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto" ||
      isProcurementApproverRole(userRole);
    const canAccessPurchaseRequests =
      canAccessProcurement || userRole === "bodeguero_proyecto";
    const canAccessPurchaseOrders =
      canAccessProcurement || userRole === "bodeguero_proyecto";
    const canAccessTransferRequests =
      canAccessProcurement || userRole === "bodeguero_proyecto";
    const canAccessInvoices =
      isAdmin ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto" ||
      userRole === "bodeguero_proyecto";
    const canAccessReviewedInvoices =
      isAdmin || userRole === "administracion_central";
    const visibleFlowTypes =
      userRole === "bodeguero_proyecto"
        ? [
            "despacho_bodega",
            "compra_directa",
            "traslado_proyecto",
            "solicitud_compra",
          ]
        : userRole === "administrador_proyecto"
          ? ["compra_directa", "solicitud_compra"]
          : null;
    const isApprover = isProcurementApproverRole(userRole);

    return db.getDashboardSidebarCounts({
      ...(userRole === "ingeniero_residente" ? { requestedById: user.id } : {}),
      ...(scopedProjectIds !== undefined
        ? { projectIds: scopedProjectIds }
        : {}),
      ...(purchaseProjectIds !== undefined ? { purchaseProjectIds } : {}),
      visibleFlowTypes,
      includeMaterialRequests: true,
      includeSupplyFlows: true,
      includePurchaseRequests:
        canAccessPurchaseRequests &&
        (!isApprover || isPurchaseRequestApprovalEnabled()),
      purchaseRequestStatus: isApprover ? "en_revision" : "pendiente",
      includePurchaseOrders:
        canAccessPurchaseOrders &&
        (!isApprover || isPurchaseOrderApprovalEnabled()),
      purchaseOrderStatus: isApprover ? "pendiente_aprobacion" : "emitida",
      includeTransferRequests: canAccessTransferRequests,
      includeFixedAssets: isAdmin,
      includeInvoices: canAccessInvoices,
      includeReviewedInvoices: canAccessReviewedInvoices,
    });
  }),
});
