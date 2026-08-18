import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { listWarehouseExitsPage } from "../paginatedLists";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function canManageWarehouseExits(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
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
  projectId: number
) {
  if (user.role === "admin") return;
  if (user.buildreqRole !== "bodeguero_proyecto") return;
  if (!canAccessProject(user, projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a salidas de bodega de otro proyecto",
    });
  }
}

async function assertWarehouseExitAccessForMutation(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  id: number
) {
  if (user.buildreqRole !== "bodeguero_proyecto") return;

  const detail = await db.getWarehouseExitById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Salida de bodega no encontrada",
    });
  }
  assertProjectScopedAccess(user, detail.warehouseExit.projectId);
}

export const warehouseExitsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().int().positive().optional(),
          status: z.string().optional(),
          includePrintedDocumentContent: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a salidas de bodega",
        });
      }

      return db.listWarehouseExits(applyProjectScope(input ?? {}, ctx.user));
    }),

  listPage: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        status: z.string().optional(),
        search: z.string().trim().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(10).max(200).optional(),
        includePrintedDocumentContent: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a salidas de bodega",
        });
      }

      return listWarehouseExitsPage(applyProjectScope(input, ctx.user));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a salidas de bodega",
        });
      }

      const detail = await db.getWarehouseExitById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Salida de bodega no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.warehouseExit.projectId);

      return detail;
    }),

  getDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a salidas de bodega",
        });
      }
      const detail = await db.getWarehouseExitById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Salida de bodega no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.warehouseExit.projectId);
      return {
        id: detail.warehouseExit.id,
        content: detail.warehouseExit.printedDocumentContent,
        mimeType: detail.warehouseExit.printedDocumentMimeType,
        name: detail.warehouseExit.printedDocumentName,
      };
    }),

  emit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para emitir salidas de bodega",
        });
      }

      await assertWarehouseExitAccessForMutation(ctx.user, input.id);
      const result = await db.emitWarehouseExit(input.id, ctx.user.id);
      for (const requestId of result.materialRequestIds ?? []) {
        await db.syncMaterialRequestFulfillmentStatus(requestId, ctx.user.id);
      }

      return result;
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        receivedByName: z.string().trim().max(255).nullable().optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
        items: z
          .array(
            z.object({
              id: z.number().int().positive(),
              quantity: z.string().trim().min(1),
              storageLocation: z.string().trim().max(255).nullable().optional(),
              notes: z.string().trim().max(1000).nullable().optional(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar salidas de bodega",
        });
      }

      await assertWarehouseExitAccessForMutation(ctx.user, input.id);
      return db.updateWarehouseExitDraft(input.id, {
        receivedByName: input.receivedByName,
        notes: input.notes,
        items: input.items,
      });
    }),

  cancelDraft: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageWarehouseExits(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para anular salidas de bodega",
        });
      }

      await assertWarehouseExitAccessForMutation(ctx.user, input.id);
      return db.cancelWarehouseExitDraft(input.id, ctx.user.id, input.reason);
    }),
});
