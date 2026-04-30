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
]);
const projectScopedRoles = new Set([
  "ingeniero_residente",
  "administrador_proyecto",
  "bodeguero_proyecto",
]);

export const userManagementRouter = router({
  list: adminProcedure.query(async () => {
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
      })
    )
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase();
      const name = input.name.trim();
      const assignedProjectId = projectScopedRoles.has(input.buildreqRole)
        ? input.assignedProjectId
        : null;

      if (projectScopedRoles.has(input.buildreqRole) && !assignedProjectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe asignar un proyecto a este rol.",
        });
      }

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
          assignedProjectId,
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
      })
    )
    .mutation(async ({ input }) => {
      return db.updateUserRole(
        input.userId,
        input.buildreqRole,
        input.assignedProjectId
      );
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
