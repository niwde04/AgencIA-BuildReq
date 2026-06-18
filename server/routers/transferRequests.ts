import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import {
  applyProjectScope,
  canAccessProject,
  isProjectAssignableRole,
} from "../projectAccess";

function canAccessTransfers(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
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

function canConvertTransferRequests(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function shouldHideTransferOriginQuantities(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return user.role !== "admin" && user.buildreqRole === "bodeguero_proyecto";
}

function redactTransferOriginQuantities(detail: any) {
  return {
    ...detail,
    items: (detail.items ?? []).map((item: any) => ({
      ...item,
      originStockQuantity: null,
      stockAfterTransfer: null,
    })),
  };
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
  if (!isProjectAssignableRole(user.buildreqRole)) return;
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
      return shouldHideTransferOriginQuantities(ctx.user)
        ? redactTransferOriginQuantities(detail)
        : detail;
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
      if (detail.transferRequest.reverseLogisticId) {
        await db.updateReverseLogisticStatus(
          detail.transferRequest.reverseLogisticId,
          "pendiente"
        );
      }

      return { success: true };
    }),

  updateDestinationWarehouse: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive().optional(),
        warehouseId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canConvertTransferRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Bodega Central o Bodega de Proyecto puede cambiar la bodega destino",
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

      if (detail.transferRequest.status !== "pendiente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se puede cambiar la bodega destino de una solicitud pendiente",
        });
      }
      if (
        detail.transferRequest.destinationType !== "proyecto" ||
        !(
          input.projectId ||
          detail.transferRequest.destinationProjectId
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Esta solicitud no tiene proyecto destino editable",
        });
      }
      if (detail.transferRequest.reverseLogisticId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La bodega destino de una devolución se define desde la devolución",
        });
      }

      const destinationProjectId =
        input.projectId ?? detail.transferRequest.destinationProjectId;
      if (!destinationProjectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione proyecto/bodega destino",
        });
      }
      if (
        input.projectId &&
        !canAccessProject(ctx.user, destinationProjectId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a la bodega destino seleccionada",
        });
      }

      const projectWarehouses = await db.listProjectWarehouses(
        destinationProjectId,
        { isActive: true }
      );
      const projectWarehouseIds = new Set(
        projectWarehouses.map(warehouse => Number(warehouse.id))
      );
      if (!projectWarehouseIds.has(input.warehouseId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione una bodega asignada al proyecto destino",
        });
      }

      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole === "bodeguero_proyecto"
      ) {
        const assignedWarehouses = await db.listWarehouses({
          isActive: true,
          assignedUserId: ctx.user.id,
        });
        const assignedWarehouseIds = new Set(
          assignedWarehouses.map(warehouse => Number(warehouse.id))
        );
        if (!assignedWarehouseIds.has(input.warehouseId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Solo puede elegir una bodega destino asignada a su usuario",
          });
        }
      }

      return db.updateTransferRequest(
        input.id,
        input.projectId
          ? {
              destinationProjectId,
              destinationWarehouseId: input.warehouseId,
            }
          : {
              destinationWarehouseId: input.warehouseId,
            }
      );
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
              sourceProjectId: z.number().int().positive().nullable().optional(),
              sourceWarehouseId: z.number().int().positive().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canConvertTransferRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Bodega Central o Bodega de Proyecto puede convertir solicitudes de traslado",
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

      if (detail.transferRequest.status !== "pendiente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se puede convertir una solicitud de traslado pendiente",
        });
      }

      try {
        return await db.createTransferFromRequest(
          input.id,
          ctx.user.id,
          input.items
        );
      } catch (error) {
        if (
          shouldHideTransferOriginQuantities(ctx.user) &&
          error instanceof Error &&
          error.message.includes("Stock insuficiente")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Stock insuficiente para completar el traslado",
          });
        }
        throw error;
      }
    }),
});
