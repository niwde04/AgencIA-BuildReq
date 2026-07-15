import { z } from "zod";
import { adminProcedure, procurementProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const systemSettingsRouter = router({
  procurementApprovals: procurementProcedure.query(() =>
    db.getProcurementApprovalSettings()
  ),

  updateProcurementApprovals: adminProcedure
    .input(
      z.object({
        purchaseRequestApprovalsEnabled: z.boolean(),
        purchaseOrderApprovalsEnabled: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      db.updateProcurementApprovalSettings({
        ...input,
        updatedByUserId: ctx.user.id,
      })
    ),
});
