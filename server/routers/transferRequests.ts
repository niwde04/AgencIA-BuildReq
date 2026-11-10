import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { listTransferRequestsPage } from "../paginatedLists";
import { protectedProcedure, router } from "../_core/trpc";
import {
  applyProjectScope,
  canAccessProject,
  isProjectAssignableRole,
} from "../projectAccess";
import {
  assertValidTransferConversionDestination,
  TransferConversionValidationError,
} from "../transferConversionValidation";

function canAccessTransfers(user: {
  role: string;
  buildreqRole?: string | null;
}) {
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
    if (!requestItem || requestItem.assignedFlow !== "traslado_proyecto")
      continue;

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
      const someAssigned = requestItems.some(
        item => item.assignedFlow !== null
      );
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
  listPage: protectedProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        status: z.string().optional(),
        search: z.string().trim().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(10).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessTransfers(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a solicitudes de traslado",
        });
      }
      return listTransferRequestsPage(applyProjectScope(input, ctx.user));
    }),

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
        destinationWarehouseId: z.number().int().positive().optional(),
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

      if (input.destinationWarehouseId !== undefined) {
        if (
          input.destinationType !== "proyecto" ||
          !input.destinationProjectId
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Seleccione el proyecto de la bodega destino",
          });
        }
        const destinationProject = await db.getProjectById(
          input.destinationProjectId
        );
        if (!destinationProject || destinationProject.status !== "activo") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Seleccione un proyecto activo para la reubicación",
          });
        }
        const assignedWarehouses = await db.listProjectWarehouses(
          input.destinationProjectId,
          { isActive: true }
        );
        if (
          !assignedWarehouses.some(
            row => row.id === input.destinationWarehouseId
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La bodega destino no está activa o asignada al proyecto",
          });
        }
      }

      return db.createTransferRequest(
        {
          materialRequestId: input.materialRequestId ?? null,
          projectId: input.projectId,
          destinationType: input.destinationType,
          destinationProjectId: input.destinationProjectId ?? null,
          destinationWarehouseId: input.destinationWarehouseId ?? null,
          createdById: ctx.user.id,
          status: "pendiente",
          neededBy: input.neededBy ? new Date(input.neededBy) : null,
          notes: input.notes,
          rejectionReason: null,
        },
        input.items.map(item => ({
          materialRequestItemId: item.materialRequestItemId ?? null,
          sourceProjectId: null,
          sourceWarehouseId: null,
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
        !(input.projectId || detail.transferRequest.destinationProjectId)
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
            },
        { requirePending: true }
      );
    }),

  convertToTransfer: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        relocationReason: z.string().trim().max(2000).optional(),
        items: z
          .array(
            z.object({
              transferRequestItemId: z.number(),
              quantity: z.string().min(1),
              sourceProjectId: z
                .number()
                .int()
                .positive()
                .nullable()
                .optional(),
              sourceWarehouseId: z.number().int().positive().optional(),
              sourceStorageLocation: z
                .string()
                .trim()
                .max(255)
                .nullable()
                .optional(),
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
          message:
            "Solo se puede convertir una solicitud de traslado pendiente",
        });
      }

      try {
        const requestedItemById = new Map(
          (detail.items ?? []).map(item => [Number(item.id), item])
        );
        const validationItems = input.items
          ? input.items.map(item => {
              const requestedItem = requestedItemById.get(
                item.transferRequestItemId
              );
              return {
                itemName: requestedItem?.itemName,
                materialRequestItemId: requestedItem?.materialRequestItemId,
                quantity: item.quantity,
                sourceProjectId: item.sourceProjectId ?? null,
                sourceWarehouseId:
                  item.sourceWarehouseId ??
                  requestedItem?.sourceWarehouseId ??
                  null,
              };
            })
          : (detail.items ?? []).map(item => ({
              itemName: item.itemName,
              materialRequestItemId: item.materialRequestItemId,
              quantity: item.quantity,
              sourceProjectId: item.sourceWarehouseId
                ? (item.sourceProjectId ?? null)
                : detail.transferRequest.projectId,
              sourceWarehouseId: item.sourceWarehouseId ?? null,
            }));

        assertValidTransferConversionDestination({
          destinationType: detail.transferRequest.destinationType,
          destinationProjectId: detail.transferRequest.destinationProjectId,
          destinationWarehouseId: detail.transferRequest.destinationWarehouseId,
          fallbackSourceProjectId: detail.transferRequest.projectId,
          materialRequestId: detail.transferRequest.materialRequestId,
          reverseLogisticId: detail.transferRequest.reverseLogisticId,
          notes: detail.transferRequest.notes,
          relocationReason: input.relocationReason,
          items: validationItems,
        });

        if (
          detail.transferRequest.destinationType === "proyecto" &&
          detail.transferRequest.destinationProjectId &&
          detail.transferRequest.destinationWarehouseId
        ) {
          const destinationWarehouses = await db.listProjectWarehouses(
            detail.transferRequest.destinationProjectId,
            { isActive: true }
          );
          const destinationWarehouseIsAssigned = destinationWarehouses.some(
            warehouse =>
              Number(warehouse.id) ===
              Number(detail.transferRequest.destinationWarehouseId)
          );
          if (!destinationWarehouseIsAssigned) {
            throw new TransferConversionValidationError(
              "El almacén destino seleccionado ya no está activo o asignado al proyecto destino"
            );
          }
        }

        return await (input.relocationReason === undefined
          ? db.createTransferFromRequest(input.id, ctx.user.id, input.items)
          : db.createTransferFromRequest(input.id, ctx.user.id, input.items, {
              relocationReason: input.relocationReason,
            }));
      } catch (error) {
        if (error instanceof TransferConversionValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
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
