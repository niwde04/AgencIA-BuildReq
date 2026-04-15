import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

function canManageOpeningBalances(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

const openingBalanceItemSchema = z.object({
  sapItemCode: z.string().trim().min(1).max(50),
  itemName: z.string().trim().min(1).max(500),
  quantity: z.string().trim().min(1),
  unit: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const openingBalancesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canManageOpeningBalances(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a saldos iniciales",
        });
      }

      return db.listOpeningBalances(input ?? undefined);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!canManageOpeningBalances(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a saldos iniciales",
        });
      }

      const detail = await db.getOpeningBalanceById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Saldo inicial no encontrado",
        });
      }

      return detail;
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        openingDate: z.string().optional(),
        notes: z.string().trim().max(2000).optional(),
        items: z.array(openingBalanceItemSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManageOpeningBalances(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar saldos iniciales",
        });
      }

      return db.createOpeningBalance(
        {
          projectId: input.projectId,
          createdById: ctx.user.id,
          openingDate: input.openingDate ? new Date(input.openingDate) : new Date(),
          notes: input.notes,
        },
        input.items.map((item) => ({
          sapItemCode: item.sapItemCode,
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          notes: item.notes,
        }))
      );
    }),
});
