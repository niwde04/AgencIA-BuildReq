import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    return db.getDashboardStats();
  }),

  sidebarCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const userRole = user.buildreqRole;
    const isAdmin = user.role === "admin";
    const scopedProjectId =
      userRole === "administrador_proyecto"
        ? user.assignedProjectId ?? undefined
        : undefined;
    const canAccessProcurement =
      isAdmin ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto";

    const [
      materialRequestsPendingApproval,
      pendingFlowRows,
      pendingPurchaseRequests,
      emittedPurchaseOrders,
      pendingTransferRequests,
    ] = await Promise.all([
      db.listMaterialRequests({
        status: "pendiente_aprobar",
        ...(userRole === "ingeniero_residente"
          ? { requestedById: user.id }
          : {}),
        ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
      }),
      db.listPendingFlowQueueItems(),
      canAccessProcurement
        ? db.listPurchaseRequests({
            status: "pendiente",
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          })
        : Promise.resolve([]),
      canAccessProcurement
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
    ]);

    return {
      materialRequestsPendingApproval:
        materialRequestsPendingApproval.length,
      supplyFlowsPending: pendingFlowRows.length,
      purchaseRequestsPending: pendingPurchaseRequests.length,
      purchaseOrdersEmitted: emittedPurchaseOrders.length,
      transferRequestsPending: pendingTransferRequests.length,
    };
  }),
});
