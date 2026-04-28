import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";

function canAccessTransfers(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

export const transfersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          receivableOnly: z.boolean().optional(),
          sourceProjectId: z.number().optional(),
          destinationProjectId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a traslados",
        });
      }

      const destinationProjectId =
        ctx.user.buildreqRole === "administrador_proyecto"
          ? ctx.user.assignedProjectId ?? undefined
          : input?.destinationProjectId;

      return db.listTransfers({
        ...(input ?? {}),
        destinationProjectId,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a traslados",
        });
      }

      const detail = await db.getTransferById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Traslado no encontrado",
        });
      }
      return detail;
    }),
});
