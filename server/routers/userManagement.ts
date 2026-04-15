import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const userManagementRouter = router({
  list: adminProcedure.query(async () => {
    return db.listUsers();
  }),

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        buildreqRole: z.enum([
          "ingeniero_residente",
          "jefe_bodega_central",
          "administracion_central",
          "administrador_proyecto",
        ]),
        assignedProjectId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return db.updateUserRole(
        input.userId,
        input.buildreqRole,
        input.assignedProjectId
      );
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),
});
