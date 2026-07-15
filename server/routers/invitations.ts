import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import {
  BUILDREQ_ROLE_CODES,
  BUILDREQ_ROLE_LABELS,
  PROJECT_REQUIRED_ROLES,
  isProcurementApproverRole,
  isProjectScopedRole,
} from "@shared/buildreq-roles";

const buildreqRoleSchema = z.enum(BUILDREQ_ROLE_CODES);

function normalizeAssignedProjectIds(
  buildreqRole: z.infer<typeof buildreqRoleSchema>,
  assignedProjectIds?: number[] | null
) {
  const projectIds = Array.from(
    new Set((assignedProjectIds ?? []).filter(projectId => projectId > 0))
  );
  if (isProjectScopedRole(buildreqRole)) {
    return projectIds;
  }
  return [];
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

function assertCanManageInvitations(user: { buildreqRole?: string | null }) {
  if (isProcurementApproverRole(user.buildreqRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar invitaciones.",
    });
  }
}

export const invitationsRouter = router({
  /** List all invitations (admin only) */
  list: adminProcedure.query(async ({ ctx }) => {
    assertCanManageInvitations(ctx.user);
    return db.listInvitations();
  }),

  /** Create a new invitation and prepare email data (admin only) */
  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        buildreqRole: buildreqRoleSchema,
        assignedProjectId: z.number().nullable().optional(),
        assignedProjectIds: z.array(z.number().int().positive()).optional(),
        origin: z.string(), // Frontend passes window.location.origin
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertCanManageInvitations(ctx.user);
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      if (
        PROJECT_REQUIRED_ROLES.has(input.buildreqRole) &&
        assignedProjectIds.length === 0
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe asignar al menos un proyecto a este rol.",
        });
      }

      const token = nanoid(32);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days to accept

      const result = await db.createInvitation({
        email: input.email,
        name: input.name,
        token,
        buildreqRole: input.buildreqRole,
        assignedProjectId: assignedProjectIds[0] ?? null,
        assignedProjectIds,
        status: "pendiente",
        invitedById: ctx.user.id,
        expiresAt,
      });

      // Build the role label for the email
      const roleLabel =
        BUILDREQ_ROLE_LABELS[input.buildreqRole] || input.buildreqRole;

      // Get project name if assigned
      let projectInfo = "";
      if (assignedProjectIds.length > 0) {
        const projects = (
          await Promise.all(
            assignedProjectIds.map(projectId => db.getProjectById(projectId))
          )
        ).filter(Boolean);
        if (projects.length > 0) {
          projectInfo = `\nProyectos asignados: ${projects
            .map(project => `${project!.code} - ${project!.name}`)
            .join(", ")}`;
        }
      }

      // Return email data for the frontend to trigger via Gmail MCP or show link
      const loginUrl = `${input.origin}`;

      return {
        id: result.id,
        token,
        emailData: {
          to: input.email,
          subject: `Invitación a BuildReq - ${roleLabel}`,
          content: `Hola ${input.name},\n\nHas sido invitado/a a unirte a BuildReq, la plataforma de gestión de requerimientos de materiales para construcción.\n\nRol asignado: ${roleLabel}${projectInfo}\n\nPara acceder a la plataforma, ingresa al siguiente enlace y autentícate con tu cuenta:\n${loginUrl}\n\nEsta invitación expira en 7 días.\n\nSaludos,\nEquipo BuildReq`,
        },
      };
    }),

  /** Cancel a pending invitation (admin only) */
  cancel: adminProcedure
    .input(z.object({ invitationId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      assertCanManageInvitations(ctx.user);
      return db.cancelInvitation(input.invitationId);
    }),

  /** Resend invitation - returns email data for frontend to trigger */
  resend: adminProcedure
    .input(
      z.object({
        invitationId: z.number(),
        origin: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertCanManageInvitations(ctx.user);
      const invitationsList = await db.listInvitations();
      const found = invitationsList.find(
        (i) => i.invitation.id === input.invitationId
      );
      if (!found) throw new Error("Invitación no encontrada");

      const inv = found.invitation;
      const roleLabel =
        BUILDREQ_ROLE_LABELS[inv.buildreqRole] || inv.buildreqRole;
      const assignedProjects = found.assignedProjects ?? [];
      const projectInfo =
        assignedProjects.length > 0
          ? `\nProyectos asignados: ${assignedProjects
              .map(project => `${project.code} - ${project.name}`)
              .join(", ")}`
          : "";

      return {
        emailData: {
          to: inv.email,
          subject: `Recordatorio: Invitación a BuildReq - ${roleLabel}`,
          content: `Hola ${inv.name},\n\nTe recordamos que tienes una invitación pendiente para unirte a BuildReq.\n\nRol asignado: ${roleLabel}${projectInfo}\n\nPara acceder a la plataforma, ingresa al siguiente enlace y autentícate con tu cuenta:\n${input.origin}\n\nSaludos,\nEquipo BuildReq`,
        },
      };
    }),
});
