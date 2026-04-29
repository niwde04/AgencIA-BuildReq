import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";

function canAccessTransfers(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function assertProjectScopedAccess(
  user: { role: string; buildreqRole?: string | null; assignedProjectId?: number | null },
  transferRequest: { projectId: number; destinationProjectId?: number | null } | null
) {
  if (user.role === "admin") return;
  if (
    user.buildreqRole !== "administrador_proyecto" &&
    user.buildreqRole !== "bodeguero_proyecto"
  ) {
    return;
  }
  if (
    !transferRequest ||
    user.assignedProjectId !== transferRequest.projectId &&
    user.assignedProjectId !== transferRequest.destinationProjectId
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a traslados de otro proyecto",
    });
  }
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

      const isProjectAdmin = ctx.user.buildreqRole === "administrador_proyecto";
      const isProjectBodeguero = ctx.user.buildreqRole === "bodeguero_proyecto";
      const scopedProjectId =
        isProjectAdmin || isProjectBodeguero
          ? ctx.user.assignedProjectId ?? -1
          : undefined;
      const sourceProjectId =
        isProjectAdmin && !input?.receivableOnly
          ? scopedProjectId
          : input?.sourceProjectId;
      const destinationProjectId =
        isProjectBodeguero || (isProjectAdmin && input?.receivableOnly)
          ? scopedProjectId
          : input?.destinationProjectId;

      return db.listTransfers({
        ...(input ?? {}),
        sourceProjectId,
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
      assertProjectScopedAccess(ctx.user, detail.transferRequest);
      return detail;
    }),
});
