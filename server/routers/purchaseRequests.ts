import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";

function canAccessPurchaseRequests(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function assertProjectScopedAccess(
  user: { role: string; buildreqRole?: string | null; assignedProjectId?: number | null },
  projectId: number
) {
  if (user.role === "admin") return;
  if (user.buildreqRole === "administrador_proyecto" && user.assignedProjectId !== projectId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a solicitudes de compra de otro proyecto",
    });
  }
}

function assertPurchaseRequestMutable(status: string) {
  if (status === "convertida") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La solicitud de compra ya fue convertida y solo está disponible en modo lectura",
    });
  }
}

const purchaseRequestItemSchema = z.object({
  materialRequestItemId: z.number().optional(),
  originalSapItemCode: z.string().optional(),
  currentSapItemCode: z.string().optional(),
  itemName: z.string().min(1),
  quantity: z.string().min(1),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

export const purchaseRequestsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a las solicitudes de compra",
        });
      }

      const projectId =
        ctx.user.buildreqRole === "administrador_proyecto"
          ? ctx.user.assignedProjectId ?? undefined
          : input?.projectId;

      return db.listPurchaseRequests({
        ...input,
        projectId,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a las solicitudes de compra",
        });
      }

      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }

      assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
      return detail;
    }),

  create: protectedProcedure
    .input(
      z.object({
        materialRequestId: z.number().optional(),
        projectId: z.number(),
        purchaseType: z.enum(["local", "extranjera"]),
        neededBy: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(purchaseRequestItemSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de compra",
        });
      }

      assertProjectScopedAccess(ctx.user, input.projectId);

      return db.createPurchaseRequest(
        {
          materialRequestId: input.materialRequestId ?? null,
          sourcePurchaseOrderId: null,
          projectId: input.projectId,
          createdById: ctx.user.id,
          purchaseType: input.purchaseType,
          status: "pendiente",
          neededBy: input.neededBy ? new Date(input.neededBy) : null,
          sapDocumentNumber: null,
          notes: input.notes,
          rejectionReason: null,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          quoteAttachmentId: null,
        },
        input.items.map((item) => ({
          materialRequestItemId: item.materialRequestItemId ?? null,
          originalSapItemCode: item.originalSapItemCode,
          currentSapItemCode: item.currentSapItemCode,
          itemName: item.itemName,
          quantity: item.quantity,
          receivedQuantity: "0.00",
          unit: item.unit,
          notes: item.notes,
        }))
      );
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        purchaseType: z.enum(["local", "extranjera"]).optional(),
        neededBy: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      if (!canAccessPurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar solicitudes de compra",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
      assertPurchaseRequestMutable(detail.purchaseRequest.status);

      return db.updatePurchaseRequest(input.id, {
        purchaseType: input.purchaseType,
        neededBy: input.neededBy ? new Date(input.neededBy) : undefined,
        notes: input.notes,
      });
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ ctx, input }) => {
      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "administrador_proyecto"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Administrador del Proyecto puede anular SC",
        });
      }

      assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
      assertPurchaseRequestMutable(detail.purchaseRequest.status);
      await db.rejectPurchaseRequest(input.id, input.reason);
      return { success: true };
    }),

  attachQuote: protectedProcedure
    .input(z.object({ id: z.number(), attachmentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      if (!canAccessPurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para adjuntar cotizaciones",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
      assertPurchaseRequestMutable(detail.purchaseRequest.status);
      return db.updatePurchaseRequest(input.id, {
        quoteAttachmentId: input.attachmentId,
      });
    }),
});
