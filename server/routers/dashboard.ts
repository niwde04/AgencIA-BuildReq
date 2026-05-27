import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

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
    const scopedProjectId =
      userRole === "administrador_proyecto" || userRole === "bodeguero_proyecto"
        ? user.assignedProjectId ?? -1
        : userRole === "ingeniero_residente"
          ? user.assignedProjectId ?? undefined
          : undefined;

    return db.getDashboardStats({
      ...(userRole === "ingeniero_residente"
        ? { requestedById: user.id }
        : {}),
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
    });
  }),

  sidebarCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const userRole = user.buildreqRole;
    if (userRole === "contable") {
      const reviewedInvoices = await db.listInvoices({ status: "revisada" });
      return {
        materialRequestsPendingApproval: 0,
        supplyFlowsPending: 0,
        purchaseRequestsPending: 0,
        purchaseOrdersEmitted: 0,
        transferRequestsPending: 0,
        invoicesPendingAttention: 0,
        invoicesReviewed: reviewedInvoices.length,
      };
    }
    const isAdmin = user.role === "admin";
    const scopedProjectId =
      userRole === "administrador_proyecto" || userRole === "bodeguero_proyecto"
        ? user.assignedProjectId ?? -1
        : undefined;
    const canAccessProcurement =
      isAdmin ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto";
    const canAccessPurchaseOrders =
      canAccessProcurement || userRole === "bodeguero_proyecto";
    const canAccessInvoices =
      isAdmin ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto" ||
      userRole === "bodeguero_proyecto";
    const canAccessReviewedInvoices = isAdmin;
    const flowQueueScope =
      userRole === "ingeniero_residente"
        ? { requestedById: user.id }
        : scopedProjectId
          ? { projectId: scopedProjectId }
          : undefined;
    const visibleFlowTypes =
      userRole === "bodeguero_proyecto"
        ? ["despacho_bodega", "compra_directa"]
        : userRole === "administrador_proyecto"
          ? ["compra_directa", "solicitud_compra"]
          : null;
    const pendingFlowRowsPromise = visibleFlowTypes
      ? Promise.all(
          visibleFlowTypes.map((flowType) =>
            db.listPendingFlowQueueItems({
              ...(flowQueueScope ?? {}),
              flowType,
            })
          )
        ).then((rows) => rows.flat())
      : db.listPendingFlowQueueItems(flowQueueScope);

    const [
      materialRequestsPendingApproval,
      pendingFlowRows,
      pendingPurchaseRequests,
      emittedPurchaseOrders,
      pendingTransferRequests,
      draftInvoices,
      rejectedInvoices,
      reviewedInvoices,
    ] = await Promise.all([
      db.listMaterialRequests({
        status: "pendiente_aprobar",
        ...(userRole === "ingeniero_residente"
          ? { requestedById: user.id }
          : {}),
        ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
      }),
      pendingFlowRowsPromise,
      canAccessProcurement
        ? db.listPurchaseRequests({
            status: "pendiente",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
      canAccessPurchaseOrders
        ? db.listPurchaseOrders({
            status: "emitida",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
      canAccessProcurement
        ? db.listTransferRequests({
            status: "pendiente",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
      canAccessInvoices
        ? db.listInvoices({
            status: "borrador",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
      canAccessInvoices
        ? db.listInvoices({
            status: "rechazada",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
      canAccessReviewedInvoices
        ? db.listInvoices({
            status: "revisada",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
    ]);

    return {
      materialRequestsPendingApproval:
        materialRequestsPendingApproval.length,
      supplyFlowsPending: pendingFlowRows.length,
      purchaseRequestsPending: pendingPurchaseRequests.length,
      purchaseOrdersEmitted: emittedPurchaseOrders.length,
      transferRequestsPending: pendingTransferRequests.length,
      invoicesPendingAttention: draftInvoices.length + rejectedInvoices.length,
      invoicesReviewed: reviewedInvoices.length,
    };
  }),
});
