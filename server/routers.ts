import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { verifySupabaseToken } from "./_core/supabaseAuth";
import { z } from "zod";

import { projectsRouter } from "./routers/projects";
import { materialRequestsRouter } from "./routers/materialRequests";
import { supplyFlowsRouter } from "./routers/supplyFlows";
import { reverseLogisticsRouter } from "./routers/reverseLogistics";
import { inventoryRouter } from "./routers/inventory";
import { notificationsRouter } from "./routers/notifications";
import { attachmentsRouter } from "./routers/attachments";
import { dashboardRouter } from "./routers/dashboard";
import { userManagementRouter } from "./routers/userManagement";
import { requestItemsRouter } from "./routers/requestItems";
import { invitationsRouter } from "./routers/invitations";
import { demoDataRouter } from "./routers/demoData";
import { warehousesRouter } from "./routers/warehouses";
import { purchaseRequestsRouter } from "./routers/purchaseRequests";
import { purchaseOrdersRouter } from "./routers/purchaseOrders";
import { transferRequestsRouter } from "./routers/transferRequests";
import { transfersRouter } from "./routers/transfers";
import { receiptsRouter } from "./routers/receipts";
import { invoicesRouter } from "./routers/invoices";
import { openingBalancesRouter } from "./routers/openingBalances";
import { warehouseExitsRouter } from "./routers/warehouseExits";
import { articlesRouter } from "./routers/articles";
import { suppliersRouter } from "./routers/suppliers";
import { retentionsRouter } from "./routers/retentions";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),

    /**
     * Called by the frontend after Supabase login.
     * Validates the Supabase JWT and stores it as a session cookie.
     */
    syncSupabaseSession: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const payload = await verifySupabaseToken(input.token);
        if (!payload?.sub) {
          throw new Error("Invalid Supabase token");
        }
        // Store the Supabase JWT as the session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, input.token, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });
        return { success: true } as const;
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // BuildReq modules
  projects: projectsRouter,
  materialRequests: materialRequestsRouter,
  supplyFlows: supplyFlowsRouter,
  reverseLogistics: reverseLogisticsRouter,
  inventory: inventoryRouter,
  notifications: notificationsRouter,
  attachments: attachmentsRouter,
  dashboard: dashboardRouter,
  userManagement: userManagementRouter,
  requestItems: requestItemsRouter,
  invitations: invitationsRouter,
  demoData: demoDataRouter,
  warehouses: warehousesRouter,
  purchaseRequests: purchaseRequestsRouter,
  purchaseOrders: purchaseOrdersRouter,
  transferRequests: transferRequestsRouter,
  transfers: transfersRouter,
  receipts: receiptsRouter,
  invoices: invoicesRouter,
  openingBalances: openingBalancesRouter,
  warehouseExits: warehouseExitsRouter,
  articles: articlesRouter,
  suppliers: suppliersRouter,
  retentions: retentionsRouter,
});

export type AppRouter = typeof appRouter;
