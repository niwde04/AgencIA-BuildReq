import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { listTransfersPage } from "../paginatedLists";
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

function canReadTransferDetails(user: { role: string; buildreqRole?: string | null }) {
  return canAccessTransfers(user) || user.buildreqRole === "contable";
}

function assertProjectScopedAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  transferRequest: { projectId: number; destinationProjectId?: number | null } | null,
  items?: Array<{ sourceProjectId?: number | null }>
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
      !canAccessProject(user, transferRequest.destinationProjectId) &&
      !(items ?? []).some(item =>
        canAccessProject(user, item.sourceProjectId)
      ))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a traslados de otro proyecto",
    });
  }
}

export const transfersRouter = router({
  listPage: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        receivableOnly: z.boolean().optional(),
        sourceProjectId: z.number().optional(),
        destinationProjectId: z.number().optional(),
        search: z.string().trim().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(10).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessTransfers(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a traslados" });
      }
      const scopedProjectIds = getProjectScopeIds(ctx.user);
      return listTransfersPage({
        ...input,
        ...(scopedProjectIds !== undefined
          ? { projectIds: scopedProjectIds }
          : {}),
      });
    }),

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
      if (!canReadTransferDetails(ctx.user)) {
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
      assertProjectScopedAccess(
        ctx.user,
        detail.transferRequest,
        detail.items
      );
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
      assertProjectScopedAccess(
        ctx.user,
        detail.transferRequest,
        detail.items
      );

      return db.updateTransferPrintFields(input.id, {
        preparedByName: input.preparedByName,
        deliveredToName: input.deliveredToName,
      });
    }),
});
