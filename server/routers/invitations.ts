import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { nanoid } from "nanoid";
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

function resolveAssignedProjectIdsInput(input: {
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
}) {
  if (Array.isArray(input.assignedProjectIds)) {
    return input.assignedProjectIds;
  }
  return input.assignedProjectId ? [input.assignedProjectId] : [];
}

export const invitationsRouter = router({
  /** List all invitations (admin only) */
  list: adminProcedure.query(async () => {
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
      const assignedProjectIds = normalizeAssignedProjectIds(
        input.buildreqRole,
        resolveAssignedProjectIdsInput(input)
      );
      if (
        projectRequiredRoles.has(input.buildreqRole) &&
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
      const roleLabels: Record<string, string> = {
        ingeniero_residente: "Requiriente",
        jefe_bodega_central: "Bodega Central",
        administracion_central: "Administración Central",
        administrador_proyecto: "Administración Proyecto",
        bodeguero_proyecto: "Bodega Proyecto",
        superintendente: "Superintendente",
        contable: "Contable",
      };
      const roleLabel = roleLabels[input.buildreqRole] || input.buildreqRole;

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
      } else if (input.buildreqRole === "administrador_proyecto") {
        projectInfo = "\nProyectos asignados: Todos los proyectos";
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      const invitationsList = await db.listInvitations();
      const found = invitationsList.find(
        (i) => i.invitation.id === input.invitationId
      );
      if (!found) throw new Error("Invitación no encontrada");

      const inv = found.invitation;
      const roleLabels: Record<string, string> = {
        ingeniero_residente: "Requiriente",
        jefe_bodega_central: "Bodega Central",
        administracion_central: "Administración Central",
        administrador_proyecto: "Administración Proyecto",
        bodeguero_proyecto: "Bodega Proyecto",
        superintendente: "Superintendente",
        contable: "Contable",
      };
      const roleLabel = roleLabels[inv.buildreqRole] || inv.buildreqRole;
      const projectInfo = found.project
        ? `\nProyecto asignado: ${found.project.code} - ${found.project.name}`
        : inv.buildreqRole === "administrador_proyecto"
          ? "\nProyecto asignado: Todos los proyectos"
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
