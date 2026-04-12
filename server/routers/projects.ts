import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const projectsRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return db.listProjects(input?.status);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProjectById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      return db.getProjectByCode(input.code);
    }),

  create: adminProcedure
    .input(
      z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        location: z.string().optional(),
        sapProjectCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check max 20 active projects
      const activeCount = await db.countActiveProjects();
      if (activeCount >= 20) {
        throw new Error(
          "Se ha alcanzado el límite máximo de 20 proyectos activos"
        );
      }
      return db.createProject(input);
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        code: z.string().min(1).max(50).optional(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        status: z.enum(["activo", "inactivo", "completado"]).optional(),
        sapProjectCode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.updateProject(id, data);
    }),
});
