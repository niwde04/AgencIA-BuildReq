import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { QUALITY_RETENTION_RELEASE_STATUS_CODES } from "@shared/quality-retention-releases";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { canAccessProject, getProjectScopeIds } from "../projectAccess";
import * as releases from "../qualityRetentionReleases";

function isCentral(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" || user.buildreqRole === "administracion_central"
  );
}

function isProjectManager(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" || user.buildreqRole === "administrador_proyecto"
  );
}

function rethrow(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof releases.QualityRetentionReleaseRuleError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  const databaseError = error as { code?: string; constraint?: string };
  if (
    databaseError.code === "23505" &&
    databaseError.constraint === "qrr_pending_adjustment_unique"
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ya existe una solicitud pendiente para esta factura.",
    });
  }
  throw error;
}

async function getAccessibleInvoice(
  invoiceId: number,
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  }
) {
  const detail = await db.getInvoiceById(invoiceId);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Factura no encontrada.",
    });
  }
  if (!canAccessProject(user, detail.invoice.projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al proyecto de esta factura.",
    });
  }
  return detail;
}

async function notifyUsers(
  users: Array<{ id: number }>,
  input: { title: string; message: string; releaseId: number }
) {
  const unique = new Map(users.map(user => [user.id, user]));
  await Promise.all(
    Array.from(unique.values()).map(user =>
      db.createNotification({
        userId: user.id,
        title: input.title,
        message: input.message,
        type: "cambio_estatus",
        relatedEntityType: "quality_retention_release",
        relatedEntityId: input.releaseId,
      })
    )
  );
}

async function handleDecision(
  user: { id: number; role: string; buildreqRole?: string | null },
  input: {
    releaseId: number;
    approved: boolean;
    approvedAmount?: number;
    comment: string;
  }
) {
  if (!isCentral(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo Administración Central puede autorizar o rechazar.",
    });
  }
  try {
    const updated = await releases.decideQualityRetentionRelease({
      ...input,
      decidedById: user.id,
    });
    const requestor = await db.getUserById(updated.requestedById);
    if (requestor) {
      await notifyUsers([requestor], {
        title: input.approved
          ? "Liberación de retención aprobada"
          : "Liberación de retención rechazada",
        message: input.approved
          ? `La solicitud fue aprobada por ${Number(updated.approvedAmount).toFixed(2)}.`
          : "La solicitud de liberación fue rechazada.",
        releaseId: updated.id,
      }).catch(error =>
        console.error("No se pudo notificar la decisión de liberación", error)
      );
    }
    return updated;
  } catch (error) {
    rethrow(error);
  }
}

export const qualityRetentionReleasesRouter = router({
  byInvoice: protectedProcedure
    .input(z.object({ invoiceId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await getAccessibleInvoice(input.invoiceId, ctx.user);
      return releases.getQualityRetentionOverview(input.invoiceId);
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          statuses: z
            .array(z.enum(QUALITY_RETENTION_RELEASE_STATUS_CODES))
            .optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      if (
        !isCentral(ctx.user) &&
        !isProjectManager(ctx.user) &&
        ctx.user.buildreqRole !== "contable"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a liberaciones de retención de calidad.",
        });
      }
      return releases.listQualityRetentionReleases({
        projectIds: getProjectScopeIds(ctx.user),
        statuses: input?.statuses,
      });
    }),

  request: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        requestedAmount: z.number().positive().max(999_999_999),
        justification: z.string().trim().min(5).max(4000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isProjectManager(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración de Proyecto puede solicitar la liberación.",
        });
      }
      const detail = await getAccessibleInvoice(input.invoiceId, ctx.user);
      try {
        const created = await releases.requestQualityRetentionRelease({
          ...input,
          requestedById: ctx.user.id,
        });
        const centralUsers = await db.getUsersByBuildreqRole(
          "administracion_central"
        );
        await notifyUsers(centralUsers, {
          title: "Liberación de retención pendiente",
          message: `Se solicitó liberar retención de calidad de la factura ${detail.invoice.invoiceDocumentNumber}.`,
          releaseId: created.id,
        }).catch(error =>
          console.error(
            "No se pudo notificar la solicitud de liberación",
            error
          )
        );
        return created;
      } catch (error) {
        rethrow(error);
      }
    }),

  decide: protectedProcedure
    .input(
      z.object({
        releaseId: z.number().int().positive(),
        approved: z.boolean(),
        approvedAmount: z.number().positive().max(999_999_999).optional(),
        comment: z.string().trim().min(5).max(4000),
      })
    )
    .mutation(({ ctx, input }) => handleDecision(ctx.user, input)),

  approve: protectedProcedure
    .input(
      z.object({
        releaseId: z.number().int().positive(),
        approvedAmount: z.number().positive().max(999_999_999),
        comment: z.string().trim().min(5).max(4000),
      })
    )
    .mutation(({ ctx, input }) =>
      handleDecision(ctx.user, { ...input, approved: true })
    ),

  reject: protectedProcedure
    .input(
      z.object({
        releaseId: z.number().int().positive(),
        comment: z.string().trim().min(5).max(4000),
      })
    )
    .mutation(({ ctx, input }) =>
      handleDecision(ctx.user, { ...input, approved: false })
    ),

  cancel: protectedProcedure
    .input(
      z.object({
        releaseId: z.number().int().positive(),
        reason: z.string().trim().min(5).max(4000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isProjectManager(ctx.user) && !isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede cancelar esta liberación.",
        });
      }
      const detail = await releases.getQualityRetentionReleaseById(
        input.releaseId
      );
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Liberación no encontrada.",
        });
      }
      if (!canAccessProject(ctx.user, detail.invoice.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso al proyecto de esta liberación.",
        });
      }
      try {
        return await releases.cancelQualityRetentionRelease({
          ...input,
          cancelledById: ctx.user.id,
        });
      } catch (error) {
        rethrow(error);
      }
    }),
});
