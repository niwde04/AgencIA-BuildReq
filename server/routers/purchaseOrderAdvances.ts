import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  canAccessProject,
  getProjectScopeIds,
} from "../projectAccess";
import * as advances from "../purchaseOrderAdvances";

type User = advances.PurchaseOrderAdvanceActor & {
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

function canManageAdvances(user: User) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Fecha inválida." });
  }
  return date;
}

function rethrowAdvanceError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof advances.PurchaseOrderAdvanceRuleError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

async function assertAdvanceAccess(user: User, advanceId: number) {
  const rows = await advances.listPurchaseOrderAdvances({
    advanceId,
    includeCancelled: true,
  });
  const detail = rows[0];
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Anticipo no encontrado.",
    });
  }
  if (!canAccessProject(user, detail.advance.projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al proyecto del anticipo.",
    });
  }
  return detail;
}

export const purchaseOrderAdvancesRouter = router({
  permissions: protectedProcedure.query(({ ctx }) => ({
    canManage: canManageAdvances(ctx.user),
  })),

  eligiblePurchaseOrders: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        currency: z.enum(["HNL", "USD"]).optional(),
        search: z.string().trim().max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canManageAdvances(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para solicitar anticipos.",
        });
      }
      if (input.projectId && !canAccessProject(ctx.user, input.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso al proyecto solicitado.",
        });
      }
      return advances.listEligiblePurchaseOrdersForAdvance({
        ...input,
        projectIds: input.projectId
          ? undefined
          : getProjectScopeIds(ctx.user),
      });
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          purchaseOrderId: z.number().int().positive().optional(),
          includeCancelled: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.purchaseOrderId) {
        const purchaseOrder = await db.getPurchaseOrderById(
          input.purchaseOrderId
        );
        if (!purchaseOrder) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden de compra no encontrada.",
          });
        }
        if (!canAccessProject(ctx.user, purchaseOrder.purchaseOrder.projectId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No tiene acceso a la orden de compra.",
          });
        }
      }
      return advances.listPurchaseOrderAdvances({
        purchaseOrderId: input?.purchaseOrderId,
        includeCancelled: input?.includeCancelled,
        projectIds: input?.purchaseOrderId
          ? undefined
          : getProjectScopeIds(ctx.user),
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ ctx, input }) => assertAdvanceAccess(ctx.user, input.id)),

  create: protectedProcedure
    .input(
      z.object({
        purchaseOrderId: z.number().int().positive(),
        requestedAmount: z.number().positive().max(999_999_999),
        requestedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageAdvances(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Administración de Proyecto pueden solicitar anticipos.",
        });
      }
      const purchaseOrder = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada.",
        });
      }
      if (!canAccessProject(ctx.user, purchaseOrder.purchaseOrder.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso al proyecto de la orden.",
        });
      }
      try {
        return await advances.createPurchaseOrderAdvance({
          actor: ctx.user,
          purchaseOrderId: input.purchaseOrderId,
          requestedAmount: input.requestedAmount,
          requestedPaymentDate: parseDate(input.requestedPaymentDate),
          notes: input.notes,
        });
      } catch (error) {
        rethrowAdvanceError(error);
      }
    }),

  cancel: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageAdvances(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para anular anticipos.",
        });
      }
      await assertAdvanceAccess(ctx.user, input.id);
      try {
        return await advances.cancelPurchaseOrderAdvance({
          advanceId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowAdvanceError(error);
      }
    }),
});
