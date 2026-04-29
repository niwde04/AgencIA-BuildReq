import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { nanoid } from "nanoid";

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
        buildreqRole: z.enum([
          "ingeniero_residente",
          "jefe_bodega_central",
          "administracion_central",
          "administrador_proyecto",
          "bodeguero_proyecto",
        ]),
        assignedProjectId: z.number().optional(),
        origin: z.string(), // Frontend passes window.location.origin
      })
    )
    .mutation(async ({ input, ctx }) => {
      const token = nanoid(32);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days to accept

      const result = await db.createInvitation({
        email: input.email,
        name: input.name,
        token,
        buildreqRole: input.buildreqRole,
        assignedProjectId: input.assignedProjectId ?? null,
        status: "pendiente",
        invitedById: ctx.user.id,
        expiresAt,
      });

      // Build the role label for the email
      const roleLabels: Record<string, string> = {
        ingeniero_residente: "Ingeniero Residente",
        jefe_bodega_central: "Jefe de Bodega Central",
        administracion_central: "Administración Central",
        administrador_proyecto: "Administrador del Proyecto",
        bodeguero_proyecto: "Bodeguero de Proyecto",
      };
      const roleLabel = roleLabels[input.buildreqRole] || input.buildreqRole;

      // Get project name if assigned
      let projectInfo = "";
      if (input.assignedProjectId) {
        const project = await db.getProjectById(input.assignedProjectId);
        if (project) {
          projectInfo = `\nProyecto asignado: ${project.code} - ${project.name}`;
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
        ingeniero_residente: "Ingeniero Residente",
        jefe_bodega_central: "Jefe de Bodega Central",
        administracion_central: "Administración Central",
        administrador_proyecto: "Administrador del Proyecto",
        bodeguero_proyecto: "Bodeguero de Proyecto",
      };
      const roleLabel = roleLabels[inv.buildreqRole] || inv.buildreqRole;
      const projectInfo = found.project
        ? `\nProyecto asignado: ${found.project.code} - ${found.project.name}`
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
