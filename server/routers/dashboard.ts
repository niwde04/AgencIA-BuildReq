import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getProjectScopeIds, hasAllProjectAccess } from "../projectAccess";
import { isProcurementApproverRole } from "@shared/buildreq-roles";
import { PROCUREMENT_APPROVALS_ENABLED } from "@shared/procurement-approvals";

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

  sidebarCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const userRole = user.buildreqRole;
    if (userRole === "contable") {
      const [reviewedInvoices, pendingFixedAssets] = await Promise.all([
        db.listInvoices({ status: "revisada" }),
        db.listArticles({
          tipoArticulo: 3,
          fixedAssetStatus: "pendiente",
          temporaryOnly: true,
          isActive: true,
          page: 1,
          pageSize: 10,
        }),
      ]);
      return {
        materialRequestsPendingApproval: 0,
        supplyFlowsPending: 0,
        purchaseRequestsPending: 0,
        purchaseOrdersEmitted: 0,
        transferRequestsPending: 0,
        fixedAssetsPending: pendingFixedAssets.total,
        invoicesPendingAttention: 0,
        invoicesReviewed: reviewedInvoices.length,
      };
    }
    const isAdmin = user.role === "admin";
    const scopedProjectIds = getProjectScopeIds(user);
    const scopedFilters =
      scopedProjectIds !== undefined ? { projectIds: scopedProjectIds } : {};
    const purchaseFilters =
      userRole === "administrador_proyecto" && hasAllProjectAccess(user)
        ? {}
        : scopedFilters;
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
    const flowQueueScope =
      userRole === "ingeniero_residente"
        ? { requestedById: user.id }
        : scopedFilters;
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
    const pendingFlowRowsPromise = visibleFlowTypes
      ? Promise.all(
          visibleFlowTypes.map(flowType =>
            db.listPendingFlowQueueItems({
              ...(flowQueueScope ?? {}),
              flowType,
            })
          )
        ).then(rows => rows.flat())
      : db.listPendingFlowQueueItems(flowQueueScope);

    const [
      materialRequestsPendingApproval,
      pendingFlowRows,
      pendingPurchaseRequests,
      emittedPurchaseOrders,
      pendingTransferRequests,
      pendingFixedAssets,
      draftInvoices,
      rejectedInvoices,
      reviewedInvoices,
    ] = await Promise.all([
      db.listMaterialRequests({
        status: "pendiente_aprobar",
        ...(userRole === "ingeniero_residente"
          ? { requestedById: user.id }
          : {}),
        ...scopedFilters,
      }),
      pendingFlowRowsPromise,
      canAccessPurchaseRequests &&
      (!isProcurementApproverRole(userRole) || PROCUREMENT_APPROVALS_ENABLED)
        ? db.listPurchaseRequests({
            status: isProcurementApproverRole(userRole)
              ? "en_revision"
              : "pendiente",
            ...purchaseFilters,
          })
        : Promise.resolve([]),
      canAccessPurchaseOrders &&
      (!isProcurementApproverRole(userRole) || PROCUREMENT_APPROVALS_ENABLED)
        ? db.listPurchaseOrders({
            status: isProcurementApproverRole(userRole)
              ? "pendiente_aprobacion"
              : "emitida",
            ...purchaseFilters,
          })
        : Promise.resolve([]),
      canAccessTransferRequests
        ? db.listTransferRequests({
            status: "pendiente",
            ...scopedFilters,
          })
        : Promise.resolve([]),
      isAdmin
        ? db.listArticles({
            tipoArticulo: 3,
            fixedAssetStatus: "pendiente",
            temporaryOnly: true,
            isActive: true,
            page: 1,
            pageSize: 10,
          })
        : Promise.resolve({ total: 0 }),
      canAccessInvoices
        ? db.listInvoices({
            status: "borrador",
            ...scopedFilters,
          })
        : Promise.resolve([]),
      canAccessInvoices
        ? db.listInvoices({
            status: "rechazada",
            ...scopedFilters,
          })
        : Promise.resolve([]),
      canAccessReviewedInvoices
        ? db.listInvoices({
            status: "revisada",
            ...scopedFilters,
          })
        : Promise.resolve([]),
    ]);

    return {
      materialRequestsPendingApproval: materialRequestsPendingApproval.length,
      supplyFlowsPending: pendingFlowRows.length,
      purchaseRequestsPending: pendingPurchaseRequests.length,
      purchaseOrdersEmitted: emittedPurchaseOrders.length,
      transferRequestsPending: pendingTransferRequests.length,
      fixedAssetsPending: pendingFixedAssets.total,
      invoicesPendingAttention: draftInvoices.length + rejectedInvoices.length,
      invoicesReviewed: reviewedInvoices.length,
    };
  }),
});
