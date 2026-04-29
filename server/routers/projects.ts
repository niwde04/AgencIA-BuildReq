import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

function isProjectScopedUser(user: {
  buildreqRole?: string | null;
}) {
  return (
    user.buildreqRole === "ingeniero_residente" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function assertProjectScopedAccess(
  user: { role: string; buildreqRole?: string | null; assignedProjectId?: number | null },
  projectId: number
) {
  if (user.role === "admin") return;
  if (!isProjectScopedUser(user)) return;
  if (!user.assignedProjectId || user.assignedProjectId !== projectId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a proyectos fuera de su asignación",
    });
  }
}

export const projectsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          forTransferSource: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (
        ctx.user.buildreqRole === "bodeguero_proyecto" &&
        input?.forTransferSource
      ) {
        return db.listProjects(input.status);
      }

      if (isProjectScopedUser(ctx.user)) {
        if (!ctx.user.assignedProjectId) return [];

        const project = await db.getProjectById(ctx.user.assignedProjectId);
        if (!project) return [];
        if (input?.status && project.status !== input.status) return [];

        return [project];
      }

      return db.listProjects(input?.status);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      assertProjectScopedAccess(ctx.user, input.id);
      return db.getProjectById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectByCode(input.code);
      if (project) {
        assertProjectScopedAccess(ctx.user, project.id);
      }
      return project;
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
