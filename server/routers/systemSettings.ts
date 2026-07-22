import { z } from "zod";
import { adminProcedure, procurementProcedure, router } from "../_core/trpc";
import * as db from "../db";

const approvalMinimumSchema = z
  .number()
  .finite()
  .min(0)
  .refine(
    value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    "El monto debe tener máximo dos decimales"
  );

export const systemSettingsRouter = router({
  procurementApprovals: procurementProcedure.query(() =>
    db.getProcurementApprovalSettings()
  ),

  updatePurchaseRequestApprovals: adminProcedure
    .input(
      z.object({
        purchaseRequestApprovalsEnabled: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      db.updatePurchaseRequestApprovalSettings({
        ...input,
        updatedByUserId: ctx.user.id,
      })
    ),

  updatePurchaseOrderApprovals: adminProcedure
    .input(
      z.object({
        purchaseOrderApprovalsEnabled: z.boolean(),
        purchaseOrderApprovalMinimumHnl: approvalMinimumSchema,
        purchaseOrderApprovalMinimumUsd: approvalMinimumSchema,
      })
    )
    .mutation(({ ctx, input }) =>
      db.updatePurchaseOrderApprovalSettings({
        ...input,
        actor: ctx.user,
      })
    ),
});
