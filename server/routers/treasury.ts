import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { TREASURY_BATCH_STATUS_CODES } from "@shared/treasury";
import { canAccessProject, getProjectScopeIds } from "../projectAccess";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as treasury from "../treasury";

type User = treasury.TreasuryActor;

const currencySchema = z.enum(["HNL", "USD"]);
const draftItemSchema = z.object({
  invoiceId: z.number().int().positive(),
  requestedAmount: z.number().positive().max(999_999_999),
});
const adjustmentSchema = z.object({
  itemId: z.number().int().positive(),
  amount: z.number().positive().max(999_999_999).optional(),
  excluded: z.boolean().optional(),
  reason: z.string().trim().max(2000).optional(),
});
const bankResponseItemSchema = z
  .object({
    itemId: z.number().int().positive(),
    paid: z.boolean(),
    paidAmount: z.number().positive().max(999_999_999).optional(),
    paidDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    bankReference: z.string().trim().max(255).optional(),
    bankComment: z.string().trim().max(2000).optional(),
  })
  .superRefine((item, ctx) => {
    if (!item.paid) return;
    if (item.paidAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paidAmount"],
        message: "Ingrese el monto pagado.",
      });
    }
    if (!item.paidDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paidDate"],
        message: "Seleccione la fecha de pago.",
      });
    }
  });
const bankResponseAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  base64: z.string().min(1).max(15_000_000),
});

function isCentral(user: User) {
  return (
    user.role === "admin" || user.buildreqRole === "administracion_central"
  );
}

function isProjectManager(user: User) {
  return (
    user.role === "admin" || user.buildreqRole === "administrador_proyecto"
  );
}

function isAccountant(user: User) {
  return user.role === "admin" || user.buildreqRole === "contable";
}

function canManageBankResponse(user: User) {
  return isCentral(user) || user.buildreqRole === "financiero";
}

async function canAccessTreasury(user: User) {
  return (
    isCentral(user) ||
    isProjectManager(user) ||
    isAccountant(user) ||
    user.buildreqRole === "financiero"
  );
}

async function assertTreasuryAccess(user: User) {
  if (!(await canAccessTreasury(user))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al módulo de Tesorería.",
    });
  }
}

async function assertTreasuryEnabled() {
  const settings = await treasury.getTreasurySettings();
  if (!settings.treasuryEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El módulo de Tesorería está deshabilitado.",
    });
  }
}

async function assertBatchAccess(user: User, batchId: number) {
  await assertTreasuryAccess(user);
  const detail = await treasury.getTreasuryBatchById(batchId);
  if (!detail) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lote no encontrado." });
  }
  if (!canAccessProject(user, detail.batch.projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a lotes de otro proyecto.",
    });
  }
  return detail;
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Fecha inválida." });
  }
  return date;
}

function rethrowTreasuryError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof treasury.TreasuryRuleError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  const databaseError = error as { code?: string; constraint?: string };
  if (
    databaseError?.code === "23505" &&
    databaseError?.constraint === "treasury_item_active_invoice_unique"
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Una factura seleccionada ya está reservada en otro lote activo.",
    });
  }
  throw error;
}

export const treasuryRouter = router({
  settings: protectedProcedure.query(async ({ ctx }) => ({
    ...(await treasury.getTreasurySettings()),
    canAccess: await canAccessTreasury(ctx.user),
    isApprover: ctx.user.buildreqRole === "financiero",
    permissions: {
      canCreate: isProjectManager(ctx.user),
      canDepurate: isCentral(ctx.user),
      canAccount: isAccountant(ctx.user),
    },
  })),

  updateSettings: adminProcedure
    .input(z.object({ treasuryEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await treasury.updateTreasurySettings({
          treasuryEnabled: input.treasuryEnabled,
          updatedByUserId: ctx.user.id,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  approvers: adminProcedure.query(() => treasury.listTreasuryApprovers()),

  eligibleInvoices: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        currency: currencySchema.optional(),
        batchId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      if (input.projectId && !canAccessProject(ctx.user, input.projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a facturas de ese proyecto.",
        });
      }
      if (input.batchId) {
        const detail = await assertBatchAccess(ctx.user, input.batchId);
        if (input.projectId && detail.batch.projectId !== input.projectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El lote no pertenece al proyecto solicitado.",
          });
        }
      }
      return treasury.listEligibleTreasuryInvoices({
        projectId: input.projectId,
        currency: input.currency,
        excludeBatchId: input.batchId,
        projectIds: input.projectId ? undefined : getProjectScopeIds(ctx.user),
      });
    }),

  list: protectedProcedure
    .input(
      z
        .object({ status: z.enum(TREASURY_BATCH_STATUS_CODES).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertTreasuryAccess(ctx.user);
      return treasury.listTreasuryBatches({
        status: input?.status,
        projectIds: getProjectScopeIds(ctx.user),
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      return assertBatchAccess(ctx.user, input.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        currency: currencySchema,
        requestedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(2000).optional(),
        items: z.array(draftItemSchema).min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      if (
        !isProjectManager(ctx.user) ||
        !canAccessProject(ctx.user, input.projectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración de Proyecto puede crear lotes de sus proyectos.",
        });
      }
      try {
        return await treasury.createTreasuryBatch({
          ...input,
          actor: ctx.user,
          requestedPaymentDate: parseDate(input.requestedPaymentDate),
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        requestedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().trim().max(2000).optional(),
        items: z.array(draftItemSchema).min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      if (
        !isProjectManager(ctx.user) ||
        !canAccessProject(ctx.user, detail.batch.projectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede editar este lote.",
        });
      }
      try {
        return await treasury.updateTreasuryDraft({
          batchId: input.id,
          actor: ctx.user,
          requestedPaymentDate: parseDate(input.requestedPaymentDate),
          notes: input.notes,
          items: input.items,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  submit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      if (
        !isProjectManager(ctx.user) ||
        !canAccessProject(ctx.user, detail.batch.projectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede enviar este lote.",
        });
      }
      try {
        return await treasury.submitTreasuryBatch(input.id, ctx.user);
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  saveReview: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        adjustments: z.array(adjustmentSchema).max(500).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede revisar lotes.",
        });
      }
      try {
        return await treasury.saveTreasuryReview({
          batchId: input.id,
          actor: ctx.user,
          adjustments: input.adjustments,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  consolidateForApproval: protectedProcedure
    .input(
      z.object({
        batchIds: z.array(z.number().int().positive()).min(2).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      if (!isCentral(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central puede consolidar lotes para aprobación.",
        });
      }
      for (const batchId of Array.from(new Set(input.batchIds))) {
        await assertBatchAccess(ctx.user, batchId);
      }
      try {
        return await treasury.consolidateTreasuryBatchesForApproval({
          batchIds: input.batchIds,
          actor: ctx.user,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  approve: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        adjustments: z.array(adjustmentSchema).max(500).default([]),
        comment: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      const approvedUser = ctx.user.buildreqRole === "financiero";
      if (!approvedUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el rol Financiero puede aprobar lotes de Tesorería.",
        });
      }
      try {
        return await treasury.approveTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          adjustments: input.adjustments,
          comment: input.comment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  returnBatch: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      const allowed =
        (detail.batch.status === "enviado_depuracion" && isCentral(ctx.user)) ||
        (detail.batch.status === "pendiente_aprobacion" &&
          ctx.user.buildreqRole === "financiero");
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede devolver este lote.",
        });
      }
      try {
        return await treasury.returnTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  exportBankWorkbook: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!canManageBankResponse(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Financiero pueden exportar al banco.",
        });
      }
      try {
        return await treasury.exportTreasuryBankWorkbook(input.id, ctx.user);
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  recordBankResponse: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        items: z.array(bankResponseItemSchema).min(1).max(500),
        attachment: bankResponseAttachmentSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!canManageBankResponse(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Financiero pueden registrar la respuesta bancaria.",
        });
      }
      try {
        return await treasury.recordTreasuryBankResponse({
          batchId: input.id,
          actor: ctx.user,
          items: input.items.map(item => ({
            ...item,
            paidDate: item.paidDate ? parseDate(item.paidDate) : undefined,
          })),
          attachment: input.attachment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  importBankWorkbook: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        fileName: z.string().trim().min(1).max(255),
        base64: z.string().min(1).max(15_000_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!canManageBankResponse(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Financiero pueden importar la respuesta bancaria.",
        });
      }
      try {
        return await treasury.importTreasuryBankWorkbook({
          batchId: input.id,
          actor: ctx.user,
          fileName: input.fileName,
          base64: input.base64,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  resolveDifference: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        itemId: z.number().int().positive(),
        resolution: z.enum(["accept", "reject"]),
        comment: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!canManageBankResponse(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Financiero pueden resolver diferencias.",
        });
      }
      try {
        return await treasury.resolveTreasuryDifference({
          batchId: input.id,
          itemId: input.itemId,
          actor: ctx.user,
          resolution: input.resolution,
          comment: input.comment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  accountItems: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        itemIds: z.array(z.number().int().positive()).min(1).max(500),
        comment: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (!isAccountant(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Contabilidad puede contabilizar abonos.",
        });
      }
      try {
        return await treasury.accountTreasuryItems({
          batchId: input.id,
          itemIds: input.itemIds,
          actor: ctx.user,
          comment: input.comment,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  reopenClosed: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      await assertBatchAccess(ctx.user, input.id);
      if (
        !isCentral(ctx.user) &&
        ctx.user.buildreqRole !== "financiero"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o Financiero pueden reabrir lotes cerrados.",
        });
      }
      try {
        return await treasury.reopenClosedTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),

  cancel: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTreasuryEnabled();
      const detail = await assertBatchAccess(ctx.user, input.id);
      const allowed =
        isCentral(ctx.user) ||
        (isProjectManager(ctx.user) &&
          canAccessProject(ctx.user, detail.batch.projectId) &&
          ["borrador", "devuelto"].includes(detail.batch.status));
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede anular este lote.",
        });
      }
      try {
        return await treasury.cancelTreasuryBatch({
          batchId: input.id,
          actor: ctx.user,
          reason: input.reason,
        });
      } catch (error) {
        rethrowTreasuryError(error);
      }
    }),
});
