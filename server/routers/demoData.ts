import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getDemoImportWorkload, parseDemoImportInput } from "../_core/demoData";
import {
  applyDemoImportProgress,
  completeDemoImportJob,
  createDemoImportJob,
  failDemoImportJob,
  getLatestDemoImportJobForUser,
} from "../_core/demoImportJobs";
import * as db from "../db";

export const demoDataRouter = router({
  status: adminProcedure.query(async () => {
    return db.getDemoDataSummary();
  }),

  latestImport: adminProcedure.query(async ({ ctx }) => {
    return getLatestDemoImportJobForUser(ctx.user.id);
  }),

  import: adminProcedure
    .input(
      z.object({
        projectsTsv: z.string().optional(),
        articlesTsv: z.string().optional(),
        suppliersTsv: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const payload = parseDemoImportInput(input);
      const workload = getDemoImportWorkload(payload);
      const job = createDemoImportJob(ctx.user.id, workload.totalRows);

      void db
        .importDemoData(payload, ctx.user.id, {
          onProgress: async (progress) => {
            applyDemoImportProgress(job.id, progress);
          },
        })
        .then((result) => {
          completeDemoImportJob(job.id, result);
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "La importacion demo fallo";
          failDemoImportJob(job.id, message);
        });

      return {
        jobId: job.id,
        totalRows: job.totalRows,
      };
    }),

  clear: adminProcedure.mutation(async () => {
    return db.clearDemoData();
  }),
});
