import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return db.getUserNotifications(ctx.user.id, input?.limit ?? 50);
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return db.getUnreadNotificationCount(ctx.user.id);
  }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.markNotificationAsRead(input.id);
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    return db.markAllNotificationsAsRead(ctx.user.id);
  }),
});
