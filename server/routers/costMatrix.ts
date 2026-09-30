import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  canManageCostMatrix,
  costMatrixFields,
  costMatrixListInput,
} from "../../shared/cost-matrix";
import * as catalog from "../costMatrix";

const catalogProcedure = protectedProcedure.use(async ({ ctx, next, path }) => {
  if (!canManageCostMatrix(ctx.user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a la matriz de costos",
    });
  const result = await next({ ctx });
  if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR") {
    const cause = result.error.cause as
      | { code?: string; cause?: { code?: string } }
      | undefined;
    console.error("[CostMatrix] Operation failed", {
      path,
      code: cause?.cause?.code ?? cause?.code,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "No se pudo completar la operación de matriz de costos. Intente nuevamente.",
    });
  }
  return result;
});
const id = z.number().int().positive();
export const costMatrixRouter = router({
  list: catalogProcedure
    .input(costMatrixListInput)
    .query(({ input }) => catalog.listCostMatrix(input)),
  getById: catalogProcedure
    .input(z.object({ id }))
    .query(({ input }) => catalog.getCostMatrix(input.id)),
  filterOptions: catalogProcedure.query(() =>
    catalog.costMatrixFilterOptions()
  ),
  create: catalogProcedure
    .input(costMatrixFields)
    .mutation(({ input, ctx }) => catalog.createCostMatrix(input, ctx.user.id)),
  update: catalogProcedure
    .input(z.object({ id, data: costMatrixFields }))
    .mutation(({ input, ctx }) =>
      catalog.updateCostMatrix(input.id, input.data, ctx.user.id)
    ),
  setActive: catalogProcedure
    .input(z.object({ id, isActive: z.boolean() }))
    .mutation(({ input, ctx }) =>
      catalog.setCostMatrixActive(input.id, input.isActive, ctx.user.id)
    ),
});
