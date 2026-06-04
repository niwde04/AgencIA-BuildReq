import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getSupabaseAdminClient } from "../_core/supabaseAdmin";
import { TRPCError } from "@trpc/server";

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
  "bodeguero_proyecto",
  "superintendente",
]);

function canManageUserPasswords(user: { role: string; buildreqRole?: string | null }) {
  return user.role === "admin" || user.buildreqRole === "administracion_central";
}

const userPasswordManagementProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!canManageUserPasswords(ctx.user)) {
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
  list: userPasswordManagementProcedure.query(async () => {
    return db.listUsers();
  }),

  createDirect: adminProcedure
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
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase();
      const name = input.name.trim();
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      assertRequiredProject(input.buildreqRole, assignedProjectIds);

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

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        buildreqRole: buildreqRoleSchema,
        assignedProjectId: z.number().int().positive().nullable().optional(),
        assignedProjectIds: z.array(z.number().int().positive()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      assertRequiredProject(input.buildreqRole, assignedProjectIds);

      return db.updateUserRole(
        input.userId,
        input.buildreqRole,
        assignedProjectIds[0] ?? null,
        assignedProjectIds
      );
    }),

  updateUserAdmin: adminProcedure
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
    .mutation(async ({ input }) => {
      const user = await db.getUserById(input.userId);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuario no encontrado.",
        });
      }

      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      assertRequiredProject(input.buildreqRole, assignedProjectIds);

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
    .mutation(async ({ input }) => {
      const user = await db.getUserById(input.userId);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuario no encontrado.",
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
