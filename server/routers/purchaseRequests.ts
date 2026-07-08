import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function canReadPurchaseRequests(user: {
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

function canManagePurchaseRequests(user: {
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

function canAttachPurchaseRequestQuotes(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    canManagePurchaseRequests(user) ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function canManagePurchaseRequestDestinations(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function assertProjectScopedAccess(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  projectId: number
) {
  if (user.role === "admin") return;
  if (
    (user.buildreqRole === "administrador_proyecto" ||
      user.buildreqRole === "bodeguero_proyecto") &&
    !canAccessProject(user, projectId)
  ) {
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
  if (status === "anulada" || status === "rechazada") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La solicitud de compra está anulada y solo está disponible en modo lectura",
    });
  }
}

async function releasePurchaseRequestFlowItems(
  materialRequestItemIds: Array<number | null | undefined>,
  userId: number,
  note: string
) {
  const affectedRequestIds = new Set<number>();

  for (const materialRequestItemId of materialRequestItemIds) {
    if (!materialRequestItemId) continue;

    const requestItem = await db.getRequestItemById(materialRequestItemId);
    if (!requestItem) continue;

    const releaseFlowTypes = ["solicitud_compra", "compra_directa"] as const;
    const activeFlowType = releaseFlowTypes.find(
      flowType => requestItem.assignedFlow === flowType
    );
    if (!activeFlowType) continue;

    affectedRequestIds.add(requestItem.requestId);
    await db.updateRequestItem(requestItem.id, {
      assignedFlow: null,
      status: "pendiente",
    });

    const activeFlow = await db.getActiveSupplyFlowForRequestItem({
      requestId: requestItem.requestId,
      requestItemId: requestItem.id,
      flowType: activeFlowType,
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
      const someAssigned = requestItems.some(item => item.assignedFlow !== null);
      await db.updateMaterialRequestStatus(
        requestId,
        someAssigned ? "en_proceso" : "en_espera",
        userId
      );
    }
  }
}

const purchaseRequestQuantitySchema = z
  .string()
  .trim()
  .min(1)
  .refine(value => Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "La cantidad debe ser un numero mayor que cero",
  });

const purchaseRequestUnitPriceSchema = z
  .string()
  .trim()
  .min(1)
  .refine(value => Number.isFinite(Number(value)) && Number(value) >= 0, {
    message: "El precio debe ser un numero valido",
  });

const optionalPrintTextSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional();

const purchaseRequestItemSchema = z.object({
  materialRequestItemId: z.number().optional(),
  originalSapItemCode: z.string().optional(),
  currentSapItemCode: z.string().optional(),
  itemName: z.string().min(1),
  quantity: purchaseRequestQuantitySchema,
  unit: z.string().optional(),
  unitPrice: purchaseRequestUnitPriceSchema.optional(),
  brand: z.string().trim().max(255).nullable().optional(),
  costResponsible: z.string().trim().max(255).nullable().optional(),
  targetType: z.enum(["subproyecto", "activo_fijo"]).nullable().optional(),
  subProjectId: z.number().int().positive().nullable().optional(),
  fixedAssetSapItemCode: z.string().nullable().optional(),
  fixedAssetName: z.string().nullable().optional(),
  notes: z.string().optional(),
});
const purchaseRequestItemUpdateSchema = z
  .object({
    id: z.number(),
    unitPrice: purchaseRequestUnitPriceSchema.optional(),
    brand: z.string().trim().max(255).nullable().optional(),
    costResponsible: z.string().trim().max(255).nullable().optional(),
    targetType: z.enum(["subproyecto", "activo_fijo"]).nullable().optional(),
    subProjectId: z.number().int().positive().nullable().optional(),
    fixedAssetSapItemCode: z.string().nullable().optional(),
    fixedAssetName: z.string().nullable().optional(),
  })
  .strict();
const purchaseTypeSchema = z.enum(["local", "extranjera", "compra_directa"]);

async function resolvePurchaseRequestItemTarget(input: {
  projectId: number;
  targetType?: "subproyecto" | "activo_fijo" | null;
  subProjectId?: number | null;
  fixedAssetSapItemCode?: string | null;
}) {
  if (!input.targetType) {
    return {
      targetType: null,
      subProjectId: null,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  if (input.targetType === "subproyecto") {
    if (!input.subProjectId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Seleccione un subproyecto válido",
      });
    }

    const subproject = await db.getProjectSubprojectById(input.subProjectId);
    if (
      !subproject ||
      subproject.projectId !== input.projectId ||
      !subproject.isActive
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "El subproyecto seleccionado no pertenece al proyecto o está inactivo",
      });
    }

    return {
      targetType: "subproyecto" as const,
      subProjectId: subproject.id,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  const fixedAssetSapItemCode = input.fixedAssetSapItemCode?.trim();
  if (!fixedAssetSapItemCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Seleccione un activo fijo válido",
    });
  }

  const fixedAsset = await db.getActiveFixedAssetByCode(
    fixedAssetSapItemCode,
    input.projectId
  );
  if (!fixedAsset) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "El activo fijo seleccionado no existe, está inactivo, no es activo fijo o no pertenece al proyecto",
    });
  }

  return {
    targetType: "activo_fijo" as const,
    subProjectId: null,
    fixedAssetSapItemCode: fixedAsset.itemCode,
    fixedAssetName: fixedAsset.description,
  };
}

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
      if (!canReadPurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a las solicitudes de compra",
        });
      }

      return db.listPurchaseRequests(applyProjectScope(input ?? {}, ctx.user));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canReadPurchaseRequests(ctx.user)) {
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
        purchaseType: purchaseTypeSchema,
        neededBy: z.string().optional(),
        printDestination: optionalPrintTextSchema,
        notes: z.string().optional(),
        items: z.array(purchaseRequestItemSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canManagePurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para crear solicitudes de compra",
        });
      }

      assertProjectScopedAccess(ctx.user, input.projectId);

      const items = await Promise.all(
        input.items.map(async item => {
          const target = await resolvePurchaseRequestItemTarget({
            projectId: input.projectId,
            targetType: item.targetType,
            subProjectId: item.subProjectId,
            fixedAssetSapItemCode: item.fixedAssetSapItemCode,
          });

          return {
            materialRequestItemId: item.materialRequestItemId ?? null,
            originalSapItemCode: item.originalSapItemCode,
            currentSapItemCode: item.currentSapItemCode,
            itemName: item.itemName,
            quantity: item.quantity,
            receivedQuantity: "0.00",
            unit: item.unit,
            unitPrice: item.unitPrice ?? "0.00",
            brand: item.brand ?? null,
            costResponsible: item.costResponsible ?? null,
            ...target,
            notes: item.notes,
          };
        })
      );

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
          printDestination: input.printDestination ?? null,
          notes: input.notes,
          rejectionReason: null,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          quoteAttachmentId: null,
        },
        items
      );
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        purchaseType: purchaseTypeSchema.optional(),
        neededBy: z.string().optional(),
        printDestination: optionalPrintTextSchema,
        notes: z.string().optional(),
        items: z.array(purchaseRequestItemUpdateSchema).optional(),
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
      if (!canManagePurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar solicitudes de compra",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
      assertPurchaseRequestMutable(detail.purchaseRequest.status);

      const itemUpdates = input.items ?? [];
      const itemById = new Map(
        (detail.items ?? []).map((item: any) => [item.id, item])
      );

      for (const itemUpdate of itemUpdates) {
        const existingItem = itemById.get(itemUpdate.id);
        if (!existingItem) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uno de los ítems no pertenece a la solicitud de compra",
          });
        }

        const itemProjectId =
          existingItem.sourceProject?.id ?? detail.purchaseRequest.projectId;
        assertProjectScopedAccess(ctx.user, itemProjectId);

        const hasTargetUpdate =
          "targetType" in itemUpdate ||
          "subProjectId" in itemUpdate ||
          "fixedAssetSapItemCode" in itemUpdate;
        if (
          hasTargetUpdate &&
          !canManagePurchaseRequestDestinations(ctx.user)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Solo el Administrador del Proyecto o Administración Central puede cambiar el destino",
          });
        }

      }

      await db.updatePurchaseRequest(input.id, {
        purchaseType: input.purchaseType,
        neededBy: input.neededBy ? new Date(input.neededBy) : undefined,
        printDestination: input.printDestination,
        notes: input.notes,
      });

      await Promise.all(
        itemUpdates.map(async itemUpdate => {
          const existingItem = itemById.get(itemUpdate.id);
          const itemProjectId =
            existingItem?.sourceProject?.id ?? detail.purchaseRequest.projectId;
          const hasTargetUpdate =
            "targetType" in itemUpdate ||
            "subProjectId" in itemUpdate ||
            "fixedAssetSapItemCode" in itemUpdate;
          const target = hasTargetUpdate
            ? await resolvePurchaseRequestItemTarget({
                projectId: itemProjectId,
                targetType: itemUpdate.targetType,
                subProjectId: itemUpdate.subProjectId,
                fixedAssetSapItemCode: itemUpdate.fixedAssetSapItemCode,
              })
            : {};

          const itemData: Parameters<typeof db.updatePurchaseRequestItem>[1] = {
            unitPrice:
              "unitPrice" in itemUpdate ? itemUpdate.unitPrice : undefined,
            brand:
              "brand" in itemUpdate ? (itemUpdate.brand ?? null) : undefined,
            costResponsible:
              "costResponsible" in itemUpdate
                ? (itemUpdate.costResponsible ?? null)
                : undefined,
            ...target,
          };

          return db.updatePurchaseRequestItem(itemUpdate.id, itemData);
        })
      );

      await db.syncPurchaseRequestConversionStatus(input.id);

      return { success: true };
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
      await releasePurchaseRequestFlowItems(
        (detail.items ?? []).map((item: any) => item.materialRequestItemId),
        ctx.user.id,
        `Flujo cancelado por anular la solicitud ${detail.purchaseRequest.requestNumber}`
      );
      await db.cancelPurchaseRequest(input.id, input.reason);
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
      if (!canAttachPurchaseRequestQuotes(ctx.user)) {
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
