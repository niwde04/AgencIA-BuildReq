import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { canAccessProject, getProjectScopeIds } from "../projectAccess";

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
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
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
    (!canAccessProject(user, transferRequest.projectId) &&
      !canAccessProject(user, transferRequest.destinationProjectId))
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

      const scopedProjectIds = getProjectScopeIds(ctx.user);

      return db.listTransfers({
        ...(input ?? {}),
        ...(scopedProjectIds !== undefined ? { projectIds: scopedProjectIds } : {}),
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

  updatePrintFields: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        preparedByName: z.string().trim().max(160).nullable().optional(),
        deliveredToName: z.string().trim().max(160).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      return db.updateTransferPrintFields(input.id, {
        preparedByName: input.preparedByName,
        deliveredToName: input.deliveredToName,
      });
    }),
});
