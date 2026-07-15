import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { applyProjectScope, canAccessProject } from "../projectAccess";
import {
  isProcurementApproverRole,
  isProjectScopedRole,
} from "@shared/buildreq-roles";
import {
  isPurchaseRequestDraftLike,
  PROCUREMENT_APPROVALS_DISABLED_MESSAGE,
  PROCUREMENT_APPROVALS_ENABLED,
} from "@shared/procurement-approvals";

function canReadPurchaseRequests(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    isProcurementApproverRole(user.buildreqRole) ||
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
  if (isProcurementApproverRole(user.buildreqRole)) return false;
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
  if (
    isProjectScopedRole(user.buildreqRole) &&
    !canAccessProject(user, projectId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a solicitudes de compra de otro proyecto",
    });
  }
}

function assertProcurementApprovalsEnabled() {
  if (!PROCUREMENT_APPROVALS_ENABLED) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: PROCUREMENT_APPROVALS_DISABLED_MESSAGE,
    });
  }
}

function assertPurchaseRequestMutable(purchaseRequest: {
  status: string;
  approvalStatus?: string | null;
}) {
  if (
    !isPurchaseRequestDraftLike(
      purchaseRequest.status,
      purchaseRequest.approvalStatus
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Solo se puede modificar o anular una solicitud de compra en borrador",
    });
  }
}

function getPurchaseRequestProjectIds(detail: any) {
  const ids = [
    detail?.purchaseRequest?.projectId,
    ...(detail?.sourceProjects ?? []).map((project: any) => project?.id),
    ...(detail?.items ?? []).map((item: any) => item?.sourceProject?.id),
  ];
  return Array.from(
    new Set(
      ids.filter(
        (projectId): projectId is number =>
          Number.isInteger(projectId) && projectId > 0
      )
    )
  );
}

function assertPurchaseRequestProjectScope(user: any, detail: any) {
  for (const projectId of getPurchaseRequestProjectIds(detail)) {
    assertProjectScopedAccess(user, projectId);
  }
}

async function validatePurchaseRequestSources(params: {
  user: any;
  projectId: number;
  materialRequestId?: number;
  materialRequestItemIds: number[];
}) {
  const sourceProjectIds = new Set<number>();

  if (params.materialRequestId) {
    const sourceRequest = await db.getMaterialRequestById(
      params.materialRequestId
    );
    if (!sourceRequest) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Requisición origen no encontrada",
      });
    }
    sourceProjectIds.add(sourceRequest.request.projectId);
    assertProjectScopedAccess(params.user, sourceRequest.request.projectId);
    if (sourceRequest.request.projectId !== params.projectId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "El proyecto de la solicitud de compra no coincide con la requisición origen",
      });
    }
  }

  for (const itemId of Array.from(new Set(params.materialRequestItemIds))) {
    const sourceItem = await db.getRequestItemById(itemId);
    if (!sourceItem) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Ítem de requisición origen ${itemId} no encontrado`,
      });
    }
    if (
      params.materialRequestId &&
      sourceItem.requestId !== params.materialRequestId
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Un ítem no pertenece a la requisición origen indicada",
      });
    }
    const sourceRequest = await db.getMaterialRequestById(sourceItem.requestId);
    if (!sourceRequest) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Requisición origen del ítem no encontrada",
      });
    }
    sourceProjectIds.add(sourceRequest.request.projectId);
    assertProjectScopedAccess(params.user, sourceRequest.request.projectId);
  }

  if (sourceProjectIds.size > 0 && !sourceProjectIds.has(params.projectId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "El proyecto de cabecera debe corresponder a uno de los proyectos origen",
    });
  }
}

const approvalDecisionSchema = z
  .object({
    id: z.number(),
    decision: z.enum(["approve", "reject"]),
    comment: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.decision === "reject" &&
      (value.comment?.trim().length ?? 0) < 5
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "El motivo de rechazo debe tener al menos 5 caracteres",
      });
    }
  });

async function notifyProjectProcurementApprovers(params: {
  projectIds: number[];
  title: string;
  message: string;
  entityId: number;
}) {
  const projectIds = Array.from(new Set(params.projectIds));
  const roleUsers = await Promise.all(
    (["superintendente_aprobador", "gerente"] as const).map(async role => {
      const usersByProject = await Promise.all(
        projectIds.map(projectId =>
          db.getUsersByBuildreqRoleAndProject(role, projectId)
        )
      );
      if (usersByProject.length === 0) return [];
      return usersByProject[0].filter(user =>
        usersByProject.every(projectUsers =>
          projectUsers.some(candidate => candidate.id === user.id)
        )
      );
    })
  );
  const usersById = new Map(
    roleUsers.flat().map(user => [user.id, user] as const)
  );
  await Promise.all(
    Array.from(usersById.values()).map(user =>
      db.createNotification({
        userId: user.id,
        title: params.title,
        message: params.message,
        type: "solicitud_compra",
        relatedEntityType: "purchase_request",
        relatedEntityId: params.entityId,
      })
    )
  );
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
  itemName?: string | null;
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
  const itemLabel = input.itemName?.trim()
    ? ` para ${input.itemName.trim()}`
    : "";
  if (!fixedAssetSapItemCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seleccione un activo fijo válido${itemLabel}; no hay código de activo fijo destino guardado`,
    });
  }

  const fixedAsset = await db.getActiveFixedAssetByCode(
    fixedAssetSapItemCode,
    input.projectId
  );
  if (!fixedAsset) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El activo fijo destino ${fixedAssetSapItemCode}${itemLabel} no existe, está inactivo, no es activo fijo o no pertenece al proyecto ${input.projectId}`,
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

      const rows = await db.listPurchaseRequests(
        applyProjectScope(input ?? {}, ctx.user)
      );
      if (!isProjectScopedRole(ctx.user.buildreqRole)) return rows;
      return rows.filter(row =>
        getPurchaseRequestProjectIds(row).every(projectId =>
          canAccessProject(ctx.user, projectId)
        )
      );
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

      assertPurchaseRequestProjectScope(ctx.user, detail);
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
      await validatePurchaseRequestSources({
        user: ctx.user,
        projectId: input.projectId,
        materialRequestId: input.materialRequestId,
        materialRequestItemIds: input.items
          .map(item => item.materialRequestItemId)
          .filter((value): value is number => typeof value === "number"),
      });

      const items = await Promise.all(
        input.items.map(async item => {
          const target = await resolvePurchaseRequestItemTarget({
            projectId: input.projectId,
            itemName: item.itemName,
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
      assertPurchaseRequestProjectScope(ctx.user, detail);
      assertPurchaseRequestMutable(detail.purchaseRequest);

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

      const resolvedItemUpdates = await Promise.all(
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
                itemName: existingItem?.itemName ?? null,
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

          return { id: itemUpdate.id, data: itemData };
        })
      );

      try {
        return await db.updateDraftPurchaseRequest({
          id: input.id,
          data: {
            purchaseType: input.purchaseType,
            neededBy: input.neededBy ? new Date(input.neededBy) : undefined,
            printDestination: input.printDestination,
            notes: input.notes,
          },
          itemUpdates: resolvedItemUpdates,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo actualizar la solicitud de compra",
        });
      }
    }),

  submitForApproval: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertProcurementApprovalsEnabled();
      if (!canManagePurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para enviar solicitudes a aprobación",
        });
      }
      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      assertPurchaseRequestProjectScope(ctx.user, detail);
      assertPurchaseRequestMutable(detail.purchaseRequest);
      if ((detail.items?.length ?? 0) === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La solicitud debe tener al menos un ítem",
        });
      }

      let result: Awaited<
        ReturnType<typeof db.submitPurchaseRequestForApproval>
      >;
      try {
        result = await db.submitPurchaseRequestForApproval({
          id: input.id,
          actor: ctx.user,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo enviar la solicitud a aprobación",
        });
      }

      try {
        await notifyProjectProcurementApprovers({
          projectIds: getPurchaseRequestProjectIds(detail),
          title: "Solicitud de compra pendiente de aprobación",
          message: `${detail.purchaseRequest.requestNumber} espera su decisión.`,
          entityId: input.id,
        });
      } catch (error) {
        console.error(
          "[PurchaseRequests] No se pudo notificar el envío a aprobación",
          error
        );
      }

      return result;
    }),

  reviewApproval: protectedProcedure
    .input(approvalDecisionSchema)
    .mutation(async ({ ctx, input }) => {
      assertProcurementApprovalsEnabled();
      if (!isProcurementApproverRole(ctx.user.buildreqRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo los roles aprobadores pueden decidir solicitudes",
        });
      }
      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      assertPurchaseRequestProjectScope(ctx.user, detail);

      let result: Awaited<ReturnType<typeof db.reviewPurchaseRequestApproval>>;
      try {
        result = await db.reviewPurchaseRequestApproval({
          id: input.id,
          decision: input.decision,
          comment: input.comment,
          actor: ctx.user,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo registrar la decisión",
        });
      }

      try {
        await db.createNotification({
          userId: detail.purchaseRequest.createdById,
          title:
            input.decision === "approve"
              ? "Solicitud de compra aprobada"
              : "Solicitud de compra rechazada",
          message:
            input.decision === "approve"
              ? `${detail.purchaseRequest.requestNumber} fue aprobada.`
              : `${detail.purchaseRequest.requestNumber} fue rechazada: ${input.comment?.trim()}`,
          type: "solicitud_compra",
          relatedEntityType: "purchase_request",
          relatedEntityId: input.id,
        });
      } catch (error) {
        console.error(
          "[PurchaseRequests] No se pudo notificar la decisión de aprobación",
          error
        );
      }

      return result;
    }),

  reopenRejected: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canManagePurchaseRequests(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para corregir solicitudes rechazadas",
        });
      }
      const detail = await db.getPurchaseRequestById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      assertPurchaseRequestProjectScope(ctx.user, detail);

      try {
        return await db.reopenRejectedPurchaseRequest({
          id: input.id,
          actor: ctx.user,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo reabrir la solicitud",
        });
      }
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
        isProcurementApproverRole(ctx.user.buildreqRole) ||
        (ctx.user.role !== "admin" &&
          ctx.user.buildreqRole !== "administrador_proyecto")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el Administrador del Proyecto puede anular SC",
        });
      }

      assertPurchaseRequestProjectScope(ctx.user, detail);
      assertPurchaseRequestMutable(detail.purchaseRequest);
      try {
        await db.cancelPurchaseRequest(input.id, input.reason);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo anular la solicitud de compra",
        });
      }
      await releasePurchaseRequestFlowItems(
        (detail.items ?? []).map((item: any) => item.materialRequestItemId),
        ctx.user.id,
        `Flujo cancelado por anular la solicitud ${detail.purchaseRequest.requestNumber}`
      );
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
      assertPurchaseRequestProjectScope(ctx.user, detail);
      assertPurchaseRequestMutable(detail.purchaseRequest);
      try {
        return await db.updateDraftPurchaseRequest({
          id: input.id,
          data: { quoteAttachmentId: input.attachmentId },
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo adjuntar la cotización",
        });
      }
    }),
});
