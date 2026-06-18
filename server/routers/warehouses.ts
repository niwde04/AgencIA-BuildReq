import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  applyProjectScope,
  canAccessProject,
  getAssignedProjectIds,
} from "../projectAccess";

const WAREHOUSE_VIEWER_ROLES = new Set([
  "jefe_bodega_central",
  "bodeguero_proyecto",
]);

function canManageWarehousesGlobally(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" || user.buildreqRole === "administracion_central"
  );
}

function assertCanManageCentralWarehouse(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  if (!canManageWarehousesGlobally(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo Administración Central puede marcar la bodega central",
    });
  }
}

function assertCanManageSharedWarehouse(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  if (!canManageWarehousesGlobally(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo Administración Central puede marcar bodegas multiproyecto",
    });
  }
}

function canManageWarehouses(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    canManageWarehousesGlobally(user) ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function isWarehouseAssignedViewer(user: { buildreqRole?: string | null }) {
  return Boolean(
    user.buildreqRole && WAREHOUSE_VIEWER_ROLES.has(user.buildreqRole)
  );
}

function isCentralWarehouseAssignableRole(role?: string | null) {
  return role === "administracion_central" || role === "jefe_bodega_central";
}

function isProjectScopedWarehouseAssignableRole(role?: string | null) {
  return role === "administrador_proyecto" || role === "bodeguero_proyecto";
}

function canReadProjectWarehouses(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  projectId?: number
) {
  if (canManageWarehousesGlobally(user)) return true;
  if (isWarehouseAssignedViewer(user)) return true;
  if (!projectId) {
    return user.buildreqRole === "administrador_proyecto";
  }
  if (
    user.buildreqRole === "administrador_proyecto" &&
    canAccessProject(user, projectId)
  ) {
    return true;
  }
  return false;
}

function assertCanManageWarehouses(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  if (!canManageWarehouses(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar almacenes",
    });
  }
}

async function assertCanManageProjectWarehouse(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  projectId: number
) {
  if (canManageWarehousesGlobally(user)) return;
  if (
    user.buildreqRole === "administrador_proyecto" &&
    canAccessProject(user, projectId)
  ) {
    return;
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Solo puede gestionar almacenes de sus proyectos asignados",
  });
}

async function assertCanManageWarehouseId(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  warehouseId: number,
  options?: { allowUnassigned?: boolean }
) {
  if (canManageWarehousesGlobally(user)) return;

  const detail = await db.getWarehouseDetailById(warehouseId);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Almacén no encontrado",
    });
  }

  const managerProjectIds = getAssignedProjectIds(user);
  const warehouseProjectIds = (detail.projects ?? []).map((project: any) =>
    Number(project.id)
  );
  const isFullyInScope =
    (options?.allowUnassigned && warehouseProjectIds.length === 0) ||
    (warehouseProjectIds.length > 0 &&
      warehouseProjectIds.every(projectId =>
        managerProjectIds.includes(projectId)
      ));
  if (!isFullyInScope) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "No puede administrar una bodega compartida con proyectos fuera de su alcance",
    });
  }
}

async function assertCanAssignWarehouseUser(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  userId: number
) {
  if (canManageWarehousesGlobally(user)) return;

  const targetUser = await db.getUserById(userId);
  if (!targetUser) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Usuario no encontrado",
    });
  }
  const managerProjectIds = getAssignedProjectIds(user);
  const targetProjectIds = getAssignedProjectIds(targetUser);
  if (isCentralWarehouseAssignableRole(targetUser.buildreqRole)) return;

  const hasSharedProject = targetProjectIds.some(projectId =>
    managerProjectIds.includes(projectId)
  );
  if (
    !isProjectScopedWarehouseAssignableRole(targetUser.buildreqRole) ||
    !hasSharedProject
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Solo puede asignar usuarios centrales, administradores de proyecto o bodegueros de proyecto dentro de sus proyectos.",
    });
  }
}

export const warehousesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().int().positive().optional(),
          isActive: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canReadProjectWarehouses(ctx.user, input?.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a los almacenes",
        });
      }

      const baseFilters = {
        isActive: input?.isActive ?? true,
        projectId: input?.projectId,
      };

      if (canManageWarehousesGlobally(ctx.user)) {
        return db.listWarehouses(baseFilters);
      }

      if (isWarehouseAssignedViewer(ctx.user)) {
        return db.listWarehouses({
          ...baseFilters,
          assignedUserId: ctx.user.id,
        });
      }

      return db.listWarehouses(applyProjectScope(baseFilters, ctx.user));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const detail = await db.getWarehouseDetailById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Almacén no encontrado",
        });
      }
      const canReadDetail =
        canManageWarehousesGlobally(ctx.user) ||
        detail.assignedUsers?.some(
          (assignedUser: { id: number }) => assignedUser.id === ctx.user.id
        ) ||
        detail.projects?.some((project: { id: number }) =>
          canAccessProject(ctx.user, project.id)
        );
      if (!canReadDetail) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a este almacén",
        });
      }
      return detail;
    }),

  create: protectedProcedure
    .input(
      z.object({
        code: z.string().trim().min(1).max(20),
        localCode: z.string().trim().min(1).max(20).optional(),
        name: z.string().trim().min(1).max(255),
        description: z.string().trim().max(1000).nullable().optional(),
        projectId: z.number().int().positive().optional(),
        isCentralWarehouse: z.boolean().optional(),
        isSharedWarehouse: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      if (input.isCentralWarehouse !== undefined) {
        assertCanManageCentralWarehouse(ctx.user);
      }
      if (input.isSharedWarehouse !== undefined) {
        assertCanManageSharedWarehouse(ctx.user);
      }
      if (
        ctx.user.buildreqRole === "administrador_proyecto" &&
        !input.projectId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione el proyecto que usará la bodega",
        });
      }
      if (input.projectId) {
        await assertCanManageProjectWarehouse(ctx.user, input.projectId);
      }

      const created = await db.createWarehouse(input);
      if (input.projectId) {
        const assignment = await db.assignProjectToWarehouse({
          warehouseId: created.warehouse.id,
          projectId: input.projectId,
        });
        return {
          ...created,
          linkedRows: assignment.linkedRows,
        };
      }
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().trim().min(1).max(20).optional(),
        localCode: z.string().trim().min(1).max(20).optional(),
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        isActive: z.boolean().optional(),
        isCentralWarehouse: z.boolean().optional(),
        isSharedWarehouse: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      if (input.isCentralWarehouse !== undefined) {
        assertCanManageCentralWarehouse(ctx.user);
      }
      if (input.isSharedWarehouse !== undefined) {
        assertCanManageSharedWarehouse(ctx.user);
      }
      await assertCanManageWarehouseId(ctx.user, input.id);

      const { id, ...data } = input;
      return db.updateWarehouse(id, data);
    }),

  assignProject: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number().int().positive(),
        projectId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageProjectWarehouse(ctx.user, input.projectId);
      await assertCanManageWarehouseId(ctx.user, input.warehouseId, {
        allowUnassigned: true,
      });

      return db.assignProjectToWarehouse(input);
    }),

  setProjectPrimary: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number().int().positive(),
        projectId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageProjectWarehouse(ctx.user, input.projectId);
      await assertCanManageWarehouseId(ctx.user, input.warehouseId);

      return db.setProjectPrimaryWarehouse(input);
    }),

  unassignProject: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number().int().positive().optional(),
        projectId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageProjectWarehouse(ctx.user, input.projectId);
      if (input.warehouseId) {
        await assertCanManageWarehouseId(ctx.user, input.warehouseId);
      }

      return db.unassignProjectFromWarehouse(input);
    }),

  deactivate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageWarehouseId(ctx.user, input.id);

      return db.updateWarehouse(input.id, { isActive: false });
    }),

  reactivate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageWarehouseId(ctx.user, input.id);

      return db.updateWarehouse(input.id, { isActive: true });
    }),

  assignableUsers: protectedProcedure.query(async ({ ctx }) => {
    if (!canManageWarehouses(ctx.user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene permisos para asignar usuarios a bodegas",
      });
    }

    const users = await db.listWarehouseAssignableUsers();
    if (canManageWarehousesGlobally(ctx.user)) return users;

    const managerProjectIds = getAssignedProjectIds(ctx.user);
    return users.filter((user: any) => {
      if (isCentralWarehouseAssignableRole(user.buildreqRole)) return true;
      const assignedProjectIds = getAssignedProjectIds(user);
      return assignedProjectIds.some(projectId =>
        managerProjectIds.includes(projectId)
      );
    });
  }),

  assignUser: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number().int().positive(),
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageWarehouseId(ctx.user, input.warehouseId);
      await assertCanAssignWarehouseUser(ctx.user, input.userId);

      return db.assignUserToWarehouse({
        ...input,
        assignedById: ctx.user.id,
      });
    }),

  unassignUser: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number().int().positive(),
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageWarehouseId(ctx.user, input.warehouseId);
      await assertCanAssignWarehouseUser(ctx.user, input.userId);

      return db.unassignUserFromWarehouse(input);
    }),

  setResponsible: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number().int().positive(),
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageWarehouses(ctx.user);
      await assertCanManageWarehouseId(ctx.user, input.warehouseId);
      await assertCanAssignWarehouseUser(ctx.user, input.userId);

      return db.setWarehouseResponsible({
        ...input,
        assignedById: ctx.user.id,
      });
    }),
});
