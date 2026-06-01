import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function canAccessTransfers(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canCreateTransferRequests(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function assertProjectScopedAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  transferRequest: { projectId: number; destinationProjectId?: number | null }
) {
  if (user.role === "admin") return;
  if (user.buildreqRole !== "administrador_proyecto") return;
  if (
    !canAccessProject(user, transferRequest.projectId) &&
    !canAccessProject(user, transferRequest.destinationProjectId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a solicitudes de traslado de otro proyecto",
    });
  }
}

async function releaseTransferRequestItems(
  materialRequestItemIds: Array<number | null | undefined>,
  userId: number,
  note: string
) {
  const affectedRequestIds = new Set<number>();

  for (const materialRequestItemId of materialRequestItemIds) {
    if (!materialRequestItemId) continue;

    const requestItem = await db.getRequestItemById(materialRequestItemId);
    if (!requestItem || requestItem.assignedFlow !== "traslado_proyecto") continue;

    affectedRequestIds.add(requestItem.requestId);
    await db.updateRequestItem(requestItem.id, {
      assignedFlow: null,
      status: "pendiente",
    });

    const activeFlow = await db.getActiveSupplyFlowForRequestItem({
      requestId: requestItem.requestId,
      requestItemId: requestItem.id,
      flowType: "traslado_proyecto",
    });

    if (activeFlow) {
      await db.updateSupplyFlowRecord(activeFlow.id, {
        status: "cancelado",
        notes: note,
      });
    }
  }

  for (const requestId of Array.from(affectedRequestIds)) {
    try {
      await db.syncMaterialRequestFulfillmentStatus(requestId, userId);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "DB not available") {
        throw error;
      }

      const requestItems = await db.getRequestItemsByRequestId(requestId);
      const someAssigned = requestItems.some((item) => item.assignedFlow !== null);
      await db.updateMaterialRequestStatus(
        requestId,
        someAssigned ? "en_proceso" : "en_espera",
        userId
      );
    }
  }
}

const transferItemSchema = z.object({
  materialRequestItemId: z.number().optional(),
  itemName: z.string().min(1),
  sapItemCode: z.string().optional(),
  quantity: z.string().min(1),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

export const transferRequestsRouter = router({
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
      if (!canAccessTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a solicitudes de traslado",
        });
      }

      return db.listTransferRequests(applyProjectScope(input ?? {}, ctx.user));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a solicitudes de traslado",
        });
      }

      const detail = await db.getTransferRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de traslado no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.transferRequest);
      return detail;
    }),

  create: protectedProcedure
    .input(
      z.object({
        materialRequestId: z.number().optional(),
        projectId: z.number(),
        destinationType: z.enum(["proyecto", "bodega_central"]),
        destinationProjectId: z.number().optional(),
        neededBy: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(transferItemSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canCreateTransferRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de traslado",
        });
      }

      return db.createTransferRequest(
        {
          materialRequestId: input.materialRequestId ?? null,
          projectId: input.projectId,
          destinationType: input.destinationType,
          destinationProjectId: input.destinationProjectId ?? null,
          createdById: ctx.user.id,
          status: "pendiente",
          neededBy: input.neededBy ? new Date(input.neededBy) : null,
          notes: input.notes,
          rejectionReason: null,
        },
        input.items.map((item) => ({
          materialRequestItemId: item.materialRequestItemId ?? null,
          itemName: item.itemName,
          sapItemCode: item.sapItemCode,
          quantity: item.quantity,
          receivedQuantity: "0.00",
          unit: item.unit,
          notes: item.notes,
        }))
      );
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "jefe_bodega_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Bodega puede rechazar solicitudes de traslado",
        });
      }

      return db.updateTransferRequest(input.id, {
        status: "rechazada",
        rejectionReason: input.reason,
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "jefe_bodega_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Bodega puede cancelar solicitudes de traslado",
        });
      }

      const detail = await db.getTransferRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de traslado no encontrada",
        });
      }

      if (detail.transferRequest.status !== "pendiente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se puede cancelar una solicitud de traslado pendiente",
        });
      }

      await releaseTransferRequestItems(
        (detail.items ?? []).map((item: any) => item.materialRequestItemId),
        ctx.user.id,
        `Flujo cancelado por anular la solicitud ${detail.transferRequest.requestNumber}`
      );

      await db.updateTransferRequest(input.id, {
        status: "anulada",
        rejectionReason: "Solicitud anulada manualmente",
      });

      return { success: true };
    }),

  convertToTransfer: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        items: z
          .array(
            z.object({
              transferRequestItemId: z.number(),
              quantity: z.string().min(1),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "jefe_bodega_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Bodega puede convertir solicitudes de traslado",
        });
      }

      const detail = await db.getTransferRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de traslado no encontrada",
        });
      }

      if (detail.transferRequest.status !== "pendiente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se puede convertir una solicitud de traslado pendiente",
        });
      }

      return db.createTransferFromRequest(input.id, ctx.user.id, input.items);
    }),
});
