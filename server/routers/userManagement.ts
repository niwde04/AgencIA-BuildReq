import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getSupabaseAdminClient } from "../_core/supabaseAdmin";
import { TRPCError } from "@trpc/server";
import { getAssignedProjectIds } from "../projectAccess";

const buildreqRoleSchema = z.enum([
  "ingeniero_residente",
  "jefe_bodega_central",
  "administracion_central",
  "administrador_proyecto",
  "bodeguero_proyecto",
  "superintendente",
  "contable",
]);
const projectRequiredRoles = new Set([
  "ingeniero_residente",
  "administrador_proyecto",
  "bodeguero_proyecto",
  "superintendente",
]);
const projectManagerAssignableRoles = new Set([
  "ingeniero_residente",
  "bodeguero_proyecto",
  "superintendente",
]);

type UserManager = {
  role: string;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

type ManagedUser = {
  id?: number;
  role?: string | null;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

function canManageUsers(user: UserManager) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function hasGlobalUserManagement(user: UserManager) {
  return user.role === "admin" || user.buildreqRole === "administracion_central";
}

function projectSetsOverlap(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some(projectId => rightSet.has(projectId));
}

function getManagedUserProjectIds(user: ManagedUser) {
  return getAssignedProjectIds({
    role: user.role ?? "user",
    buildreqRole: user.buildreqRole,
    assignedProjectId: user.assignedProjectId,
    assignedProjectIds: user.assignedProjectIds,
  });
}

function assertCanManageUsers(user: UserManager) {
  if (!canManageUsers(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar usuarios.",
    });
  }
}

function assertCanManageTargetUser(manager: UserManager, target: ManagedUser) {
  if (target.role === "admin" && manager.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar administradores base.",
    });
  }

  if (hasGlobalUserManagement(manager)) return;

  const managerProjectIds = getAssignedProjectIds(manager);
  const targetProjectIds = getManagedUserProjectIds(target);
  if (
    target.role === "admin" ||
    target.buildreqRole === "administracion_central" ||
    target.buildreqRole === "jefe_bodega_central" ||
    target.buildreqRole === "administrador_proyecto" ||
    target.buildreqRole === "contable" ||
    !projectSetsOverlap(managerProjectIds, targetProjectIds)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar este usuario.",
    });
  }
}

function assertAssignableRoleAndProjects(
  manager: UserManager,
  buildreqRole: z.infer<typeof buildreqRoleSchema>,
  assignedProjectIds: number[]
) {
  if (hasGlobalUserManagement(manager)) return;

  if (!projectManagerAssignableRoles.has(buildreqRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "El Administrador de Proyecto solo puede asignar roles operativos del proyecto.",
    });
  }

  const managerProjectIds = getAssignedProjectIds(manager);
  const outsideScope = assignedProjectIds.some(
    projectId => !managerProjectIds.includes(projectId)
  );
  if (assignedProjectIds.length === 0 || outsideScope) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo puede asignar proyectos bajo su administración.",
    });
  }
}

function canManageUserPasswords(
  manager: UserManager,
  target?: ManagedUser | null
) {
  if (!canManageUsers(manager)) return false;
  if (!target || hasGlobalUserManagement(manager)) return true;
  try {
    assertCanManageTargetUser(manager, target);
    return true;
  } catch {
    return false;
  }
}

const userPasswordManagementProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!canManageUsers(ctx.user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar contraseñas de usuarios.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

function normalizeAssignedProjectIds(
  buildreqRole: z.infer<typeof buildreqRoleSchema>,
  assignedProjectIds?: number[] | null
) {
  const projectIds = Array.from(
    new Set((assignedProjectIds ?? []).filter(projectId => projectId > 0))
  );
  if (buildreqRole === "administrador_proyecto") {
    return projectIds;
  }
  if (projectRequiredRoles.has(buildreqRole)) {
    return projectIds;
  }
  return [];
}

function assertRequiredProject(
  buildreqRole: z.infer<typeof buildreqRoleSchema>,
  assignedProjectIds: number[]
) {
  if (projectRequiredRoles.has(buildreqRole) && assignedProjectIds.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Debe asignar al menos un proyecto a este rol.",
    });
  }
}

function resolveAssignedProjectIdsInput(input: {
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
}) {
  if (Array.isArray(input.assignedProjectIds)) {
    return input.assignedProjectIds;
  }
  return input.assignedProjectId ? [input.assignedProjectId] : [];
}

export const userManagementRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    assertCanManageUsers(ctx.user);
    const users = await db.listUsers();
    if (hasGlobalUserManagement(ctx.user)) {
      return users;
    }

    const managerProjectIds = getAssignedProjectIds(ctx.user);
    return users.filter(user =>
      projectSetsOverlap(managerProjectIds, getAssignedProjectIds(user))
    );
  }),

  createDirect: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        email: z.string().trim().email(),
        password: z.string().min(8),
        buildreqRole: buildreqRoleSchema,
        assignedProjectId: z.number().int().positive().nullable().optional(),
        assignedProjectIds: z.array(z.number().int().positive()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageUsers(ctx.user);
      const email = input.email.toLowerCase();
      const name = input.name.trim();
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      assertRequiredProject(input.buildreqRole, assignedProjectIds);
      assertAssignableRoleAndProjects(
        ctx.user,
        input.buildreqRole,
        assignedProjectIds
      );

      const existingUser = await db.getUserByEmail(email);
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe un usuario con ese correo.",
        });
      }

      try {
        const supabase = getSupabaseAdminClient();
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: input.password,
          email_confirm: true,
          user_metadata: {
            name,
            full_name: name,
          },
        });

        if (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }

        if (!data.user?.id) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Supabase no devolvio el usuario creado.",
          });
        }

        await db.upsertUser({
          openId: data.user.id,
          name,
          email,
          loginMethod: "email",
          role: "user",
          buildreqRole: input.buildreqRole,
          assignedProjectId: assignedProjectIds[0] ?? null,
          assignedProjectIds,
          mustChangePassword: true,
          lastSignedIn: new Date(),
        });

        return { success: true } as const;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo crear el usuario.",
        });
      }
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        buildreqRole: buildreqRoleSchema,
        assignedProjectId: z.number().int().positive().nullable().optional(),
        assignedProjectIds: z.array(z.number().int().positive()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageUsers(ctx.user);
      if (ctx.user.role !== "admin") {
        const user = await db.getUserById(input.userId);
        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Usuario no encontrado.",
          });
        }
        assertCanManageTargetUser(ctx.user, user);
      }
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      assertRequiredProject(input.buildreqRole, assignedProjectIds);
      assertAssignableRoleAndProjects(
        ctx.user,
        input.buildreqRole,
        assignedProjectIds
      );

      return db.updateUserRole(
        input.userId,
        input.buildreqRole,
        assignedProjectIds[0] ?? null,
        assignedProjectIds
      );
    }),

  updateUserAdmin: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        name: z.string().trim().min(1).max(255),
        email: z.string().trim().email(),
        buildreqRole: buildreqRoleSchema,
        assignedProjectId: z.number().int().positive().nullable().optional(),
        assignedProjectIds: z.array(z.number().int().positive()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageUsers(ctx.user);
      const user = await db.getUserById(input.userId);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuario no encontrado.",
        });
      }
      assertCanManageTargetUser(ctx.user, user);

      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      assertRequiredProject(input.buildreqRole, assignedProjectIds);
      assertAssignableRoleAndProjects(
        ctx.user,
        input.buildreqRole,
        assignedProjectIds
      );

      try {
        const supabase = getSupabaseAdminClient();
        const { error } = await supabase.auth.admin.updateUserById(
          user.openId,
          {
            email,
            email_confirm: true,
            user_metadata: {
              name,
              full_name: name,
            },
          } as any
        );

        if (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }

        return db.updateUserAdmin(input.userId, {
          name,
          email,
          buildreqRole: input.buildreqRole,
          assignedProjectIds,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo actualizar el usuario.",
        });
      }
    }),

  resetPasswordAdmin: userPasswordManagementProcedure
    .input(
      z.object({
        userId: z.number(),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserById(input.userId);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuario no encontrado.",
        });
      }
      if (!canManageUserPasswords(ctx.user, user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cambiar la contraseña de este usuario.",
        });
      }

      try {
        const supabase = getSupabaseAdminClient();
        const { error } = await supabase.auth.admin.updateUserById(
          user.openId,
          { password: input.password }
        );

        if (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }

        await db.updateUserPasswordChangeRequirement(input.userId, true);
        return { success: true } as const;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo cambiar la contraseña.",
        });
      }
    }),

  updateProfileName: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();

      try {
        const supabase = getSupabaseAdminClient();
        const { error } = await supabase.auth.admin.updateUserById(
          ctx.user.openId,
          {
            user_metadata: {
              name,
              full_name: name,
            },
          }
        );

        if (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }

        await db.updateUserName(ctx.user.id, name);
        return { success: true } as const;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo actualizar el perfil.",
        });
      }
    }),

  markPasswordChanged: protectedProcedure.mutation(async ({ ctx }) => {
    return db.updateUserPasswordChangeRequirement(ctx.user.id, false);
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),
});
