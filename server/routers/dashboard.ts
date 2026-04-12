import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    return db.getDashboardStats();
  }),
});
