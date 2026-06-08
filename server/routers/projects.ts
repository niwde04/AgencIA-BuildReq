import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import {
  canAccessProject,
  getAssignedProjectIds,
  hasAllProjectAccess,
} from "../projectAccess";

const optionalDateInput = z.string().optional().nullable();
const subprojectStatusInput = z.boolean().default(true);

function isProjectScopedUser(user: {
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
}) {
  return (
    user.buildreqRole === "ingeniero_residente" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "superintendente"
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
  if (!isProjectScopedUser(user)) return;
  if (!canAccessProject(user, projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a proyectos fuera de su asignación",
    });
  }
}

function assertCanManageSubprojects(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  projectId: number
) {
  if (user.role === "admin" || user.buildreqRole === "administracion_central") {
    return;
  }
  if (
    user.buildreqRole === "administrador_proyecto" &&
    canAccessProject(user, projectId)
  ) {
    return;
  }

    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "required permission: No tiene permisos para administrar subproyectos.",
    });
}

function parseOptionalDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La fecha indicada no es válida",
    });
  }

  return date;
}

function assertDateRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined
) {
  if (!startDate || !endDate) return;
  if (endDate.getTime() < startDate.getTime()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La fecha de fin no puede ser anterior a la fecha de inicio",
    });
  }
}

async function assertProjectExists(projectId: number) {
  const project = await db.getProjectById(projectId);
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Proyecto no encontrado",
    });
  }
  return project;
}

async function assertUniqueSubprojectCode(params: {
  projectId: number;
  code: string;
  currentId?: number;
}) {
  const existing = await db.getProjectSubprojectByCode(
    params.projectId,
    params.code
  );
  if (existing && existing.id !== params.currentId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ya existe un subproyecto con ese código en este proyecto",
    });
  }
}

const projectDateFieldsSchema = {
  startDate: optionalDateInput,
  endDate: optionalDateInput,
};

const subprojectInputSchema = z.object({
  projectId: z.number().int().positive(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().optional().nullable(),
  startDate: optionalDateInput,
  endDate: optionalDateInput,
  isActive: subprojectStatusInput,
});

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

      if (isProjectScopedUser(ctx.user) && !hasAllProjectAccess(ctx.user)) {
        const assignedProjectIds = getAssignedProjectIds(ctx.user);
        if (assignedProjectIds.length === 0) return [];

        const projectRows = await Promise.all(
          assignedProjectIds.map(projectId => db.getProjectById(projectId))
        );
        return projectRows.filter(
          (project): project is NonNullable<typeof project> =>
            Boolean(project) &&
            (!input?.status || project!.status === input.status)
        );
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
        code: z.string().trim().min(1).max(50),
        name: z.string().trim().min(1).max(255),
        description: z.string().trim().optional().nullable(),
        location: z.string().trim().optional().nullable(),
        sapProjectCode: z.string().trim().optional().nullable(),
        status: z.enum(["activo", "inactivo"]).default("activo"),
        ...projectDateFieldsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const startDate = parseOptionalDate(input.startDate);
      const endDate = parseOptionalDate(input.endDate);
      assertDateRange(startDate, endDate);

      return db.createProject({
        code: input.code,
        name: input.name,
        description: input.description?.trim() || null,
        location: input.location?.trim() || null,
        sapProjectCode: input.sapProjectCode?.trim() || null,
        status: input.status,
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
      });
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        code: z.string().trim().min(1).max(50).optional(),
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().optional().nullable(),
        location: z.string().trim().optional().nullable(),
        status: z.enum(["activo", "inactivo"]).optional(),
        sapProjectCode: z.string().trim().optional().nullable(),
        ...projectDateFieldsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const startDate = parseOptionalDate(input.startDate);
      const endDate = parseOptionalDate(input.endDate);
      assertDateRange(startDate, endDate);

      const data = {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.location !== undefined
          ? { location: input.location?.trim() || null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sapProjectCode !== undefined
          ? { sapProjectCode: input.sapProjectCode?.trim() || null }
          : {}),
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
      };

      return db.updateProject(input.id, data);
    }),

  listSubprojects: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      assertProjectScopedAccess(ctx.user, input.projectId);
      await assertProjectExists(input.projectId);
      return db.listProjectSubprojects(input.projectId);
    }),

  createSubproject: protectedProcedure
    .input(subprojectInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageSubprojects(ctx.user, input.projectId);
      const startDate = parseOptionalDate(input.startDate);
      const endDate = parseOptionalDate(input.endDate);
      assertDateRange(startDate, endDate);
      await assertProjectExists(input.projectId);
      await assertUniqueSubprojectCode({
        projectId: input.projectId,
        code: input.code,
      });

      return db.createProjectSubproject({
        projectId: input.projectId,
        code: input.code,
        name: input.name,
        description: input.description?.trim() || null,
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
        isActive: input.isActive,
      });
    }),

  updateSubproject: protectedProcedure
    .input(
      subprojectInputSchema.extend({
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageSubprojects(ctx.user, input.projectId);
      const existing = await db.getProjectSubprojectById(input.id);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subproyecto no encontrado",
        });
      }
      assertCanManageSubprojects(ctx.user, existing.projectId);

      const startDate = parseOptionalDate(input.startDate);
      const endDate = parseOptionalDate(input.endDate);
      assertDateRange(startDate, endDate);
      await assertProjectExists(input.projectId);
      await assertUniqueSubprojectCode({
        projectId: input.projectId,
        code: input.code,
        currentId: input.id,
      });

      return db.updateProjectSubproject(input.id, {
        projectId: input.projectId,
        code: input.code,
        name: input.name,
        description: input.description?.trim() || null,
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
        isActive: input.isActive,
      });
    }),
});
