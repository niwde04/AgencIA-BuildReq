import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import {
  calculateDefaultNeededBy,
  formatDateForDisplay,
  isUrgentDateWithinPolicy,
  parseDateInput,
  PURCHASE_URGENCY_LABELS,
  STANDARD_PURCHASE_LEAD_DAYS,
} from "@shared/material-requests";
import { applyProjectScope, canAccessProject } from "../projectAccess";

const requestItemSchema = z.object({
  itemName: z.string().max(500).optional(),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  notes: z.string().optional(),
  targetType: z.enum(["subproyecto", "activo_fijo"]).nullable().optional(),
  subProjectId: z.number().int().positive().nullable().optional(),
  fixedAssetSapItemCode: z.string().nullable().optional(),
  fixedAssetName: z.string().nullable().optional(),
});
const createMaterialRequestInput = z
  .object({
    saveMode: z.enum(["draft", "submit"]).default("submit"),
    projectId: z.number(),
    requestType: z.enum(["bienes", "servicios"]).default("bienes"),
    recipient: z
      .enum([
        "bodega_central",
        "bodega_proyecto",
        "administrador_proyecto",
        "oficina_central",
        "solicitud_compra",
      ])
      .optional(),
    purchaseUrgency: z.enum(["urgente", "no_urgente"]).default("no_urgente"),
    neededBy: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(requestItemSchema),
  })
  .superRefine((value, ctx) => {
    const completeItems = value.items.filter(
      (item) => item.itemName?.trim() && item.quantity?.trim() && item.unit?.trim()
    );
    const hasPartialItems = value.items.some((item) => {
      const hasAnyValue = Boolean(
        item.itemName?.trim() ||
          item.quantity?.trim() ||
          item.unit?.trim() ||
          item.notes?.trim() ||
          item.targetType ||
          item.subProjectId ||
          item.fixedAssetSapItemCode?.trim()
      );
      const isComplete = Boolean(
        item.itemName?.trim() && item.quantity?.trim() && item.unit?.trim()
      );
      return hasAnyValue && !isComplete;
    });

    if (hasPartialItems) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Complete o elimine los ítems incompletos antes de guardar",
      });
    }

    if (value.saveMode === "submit" && completeItems.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Debe incluir al menos un ítem completo",
      });
    }

    if (value.saveMode !== "submit" || value.purchaseUrgency !== "urgente") {
      return;
    }

    if (!value.neededBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["neededBy"],
        message: "La fecha necesaria es obligatoria para compras urgentes",
      });
      return;
    }

    let parsedDate: Date;
    try {
      parsedDate = parseDateInput(value.neededBy);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["neededBy"],
        message: "La fecha necesaria no es válida",
      });
      return;
    }

    const today = new Date();
    const normalizedToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
      0,
      0,
      0
    );

    if (parsedDate.getTime() < normalizedToday.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["neededBy"],
        message: "La fecha necesaria no puede ser anterior a hoy",
      });
    }

    if (!isUrgentDateWithinPolicy(parsedDate, today)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["neededBy"],
        message: `Para clasificarla como urgente, la fecha necesaria debe ser menor al plazo estándar de ${STANDARD_PURCHASE_LEAD_DAYS} días calendario`,
      });
    }
  });

function getCompleteRequestItems(items: z.infer<typeof requestItemSchema>[]) {
  return items
    .filter((item) => item.itemName?.trim() && item.quantity?.trim() && item.unit?.trim())
    .map((item) => ({
      itemName: item.itemName!.trim(),
      quantity: item.quantity!.trim(),
      unit: item.unit?.trim() || undefined,
      notes: item.notes?.trim() || undefined,
      targetType: item.targetType ?? null,
      subProjectId: item.subProjectId ?? null,
      fixedAssetSapItemCode: item.fixedAssetSapItemCode?.trim() || null,
      fixedAssetName: item.fixedAssetName?.trim() || null,
    }));
}

function buildRequestItemsForPersistence(params: {
  requestType: "bienes" | "servicios";
  saveMode: "draft" | "submit";
  items: ReturnType<typeof getCompleteRequestItems>;
}) {
  const approvalStatus: "pendiente" | "no_requiere" =
    params.requestType === "bienes" && params.saveMode === "submit"
      ? "pendiente"
      : "no_requiere";

  return params.items.map((item) => ({
    ...item,
    approvalStatus,
    approvedById: null,
    approvedAt: null,
    rejectionReason: null,
  }));
}

function resolveMaterialRequestDefaults(input: {
  requestType: "bienes" | "servicios";
  recipient?: "bodega_central" | "bodega_proyecto" | "administrador_proyecto" | "oficina_central" | "solicitud_compra";
  purchaseUrgency: "urgente" | "no_urgente";
  neededBy?: string;
  saveMode: "draft" | "submit";
}) {
  const resolvedNeededBy =
    input.purchaseUrgency === "urgente" && input.neededBy
      ? parseDateInput(input.neededBy)
      : calculateDefaultNeededBy();
  const isService = input.requestType === "servicios";
  const isDraft = input.saveMode === "draft";
  const recipient =
    input.recipient ??
    (isDraft
      ? isService
        ? "administrador_proyecto"
        : "bodega_proyecto"
      : "administrador_proyecto");

  return {
    recipient,
    resolvedNeededBy,
    status: isDraft ? "borrador" : "pendiente_aprobar",
    workflowStage: isDraft
      ? isService
        ? "administrador_proyecto"
        : "bodega_proyecto"
      : "administrador_proyecto",
    approvalStatus: isDraft ? "no_requiere" : "pendiente",
  } as const;
}

function canAccessRequest(
  user: {
    id: number;
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  request: { requestedById: number; projectId: number }
) {
  if (user.role === "admin") return true;
  if (user.buildreqRole === "ingeniero_residente") {
    return request.requestedById === user.id;
  }
  if (user.buildreqRole === "administrador_proyecto") {
    return canAccessProject(user, request.projectId);
  }
  if (user.buildreqRole === "bodeguero_proyecto") {
    return canAccessProject(user, request.projectId);
  }
  if (user.buildreqRole === "superintendente") {
    return canAccessProject(user, request.projectId);
  }
  return true;
}

function hideWarehouseStockQuantities<T extends { items: any[] }>(detail: T): T {
  return {
    ...detail,
    items: detail.items.map((item) => ({
      ...item,
      projectStock: null,
      projectStockWarehouses: [],
      sapStock: null,
    })),
  };
}

function assertNotSuperintendentReadOnly(user: { buildreqRole?: string | null }) {
  if (user.buildreqRole === "superintendente") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "El Superintendente solo puede consultar requisiciones",
    });
  }
}

function assertProjectScopedCreation(
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
    user.buildreqRole !== "ingeniero_residente" &&
    user.buildreqRole !== "administrador_proyecto" &&
    user.buildreqRole !== "bodeguero_proyecto" &&
    user.buildreqRole !== "superintendente"
  ) {
    return;
  }
  if (!canAccessProject(user, projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a requisiciones de otro proyecto",
    });
  }
}

async function resolveMaterialRequestTarget(input: {
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
        message: "El subproyecto seleccionado no pertenece al proyecto o está inactivo",
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

async function resolveRequestItemTargets(
  projectId: number,
  items: ReturnType<typeof getCompleteRequestItems>
) {
  const resolvedItems = [];

  for (const item of items) {
    const targetData = await resolveMaterialRequestTarget({
      projectId,
      targetType: item.targetType,
      subProjectId: item.subProjectId,
      fixedAssetSapItemCode: item.fixedAssetSapItemCode,
    });

    resolvedItems.push({
      ...item,
      ...targetData,
    });
  }

  return resolvedItems;
}

function canEditRequestDraft(
  user: {
    id: number;
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  detail: Awaited<ReturnType<typeof db.getMaterialRequestById>>
) {
  if (!detail) return false;

  const isOwner = detail.request.requestedById === user.id;
  const isAdmin = user.role === "admin";
  const isAssignedProjectAdmin =
    user.buildreqRole === "administrador_proyecto" &&
    canAccessProject(user, detail.request.projectId);

  if (!isOwner && !isAdmin && !isAssignedProjectAdmin) {
    return false;
  }

  if (detail.request.status === "borrador") {
    return true;
  }

  if (
    detail.request.status !== "en_espera" &&
    detail.request.status !== "pendiente_aprobar"
  ) {
    return false;
  }

  return detail.items.every((item) => {
    const hasMovement =
      Number(item.deliveredQuantity ?? 0) > 0 || Number(item.dispatchedQuantity ?? 0) > 0;
    const hasReviewDecision =
      item.approvalStatus === "aprobada" || item.approvalStatus === "rechazada";
    return !item.assignedFlow && !item.sapItemCode && !hasMovement && !hasReviewDecision;
  });
}

function canApproveRequestAuthorization(
  user: { role: string; buildreqRole?: string | null }
) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

async function notifyMaterialRequestSubmitted(params: {
  requestId: number;
  requestNumber: string;
  projectId: number;
  requestType: "bienes" | "servicios";
  purchaseUrgency: "urgente" | "no_urgente";
  resolvedNeededBy: Date;
  requestedById: number;
}) {
  const neededByLabel = formatDateForDisplay(params.resolvedNeededBy);
  const urgencyLabel = PURCHASE_URGENCY_LABELS[params.purchaseUrgency];
  const dueDateMessage = `Clasificada como ${urgencyLabel}. Fecha necesaria: ${neededByLabel}.`;

  const projectAdmins = await db.getUsersByBuildreqRoleAndProject(
    "administrador_proyecto",
    params.projectId
  );
  const centralAdmins = await db.getUsersByBuildreqRole("administracion_central");
  for (const projectAdmin of projectAdmins) {
    await db.createNotification({
      userId: projectAdmin.id,
      title:
        params.requestType === "bienes"
          ? "Nueva requisición pendiente de autorización"
          : "Nueva requisición de servicios",
      message:
        params.requestType === "bienes"
          ? `La requisición ${params.requestNumber} requiere autorización del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto antes de traducir y asignar flujos. ${dueDateMessage}`
          : `La requisición ${params.requestNumber} requiere aprobación del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto. ${dueDateMessage}`,
      type: "nueva_solicitud",
      relatedEntityType: "material_request",
      relatedEntityId: params.requestId,
    });
  }

  for (const centralAdmin of centralAdmins) {
    await db.createNotification({
      userId: centralAdmin.id,
      title:
        params.requestType === "bienes"
          ? "Nueva requisición pendiente de autorización"
          : "Nueva requisición de servicios",
      message:
        params.requestType === "bienes"
          ? `La requisición ${params.requestNumber} requiere autorización del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto antes de traducir y asignar flujos. ${dueDateMessage}`
          : `La requisición ${params.requestNumber} requiere aprobación del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto. ${dueDateMessage}`,
      type: "nueva_solicitud",
      relatedEntityType: "material_request",
      relatedEntityId: params.requestId,
    });
  }

  await db.createNotification({
    userId: params.requestedById,
    title:
      params.purchaseUrgency === "urgente"
        ? "Requisición urgente registrada"
        : "Requisición registrada",
    message:
      params.requestType === "bienes"
        ? `La requisición ${params.requestNumber} quedó registrada y fue enviada para autorización. ${dueDateMessage}`
        : `La requisición ${params.requestNumber} quedó registrada. ${dueDateMessage}`,
    type: "sistema",
    relatedEntityType: "material_request",
    relatedEntityId: params.requestId,
  });
}

export const materialRequestsRouter = router({
  targetOptions: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      assertProjectScopedCreation(ctx.user, input.projectId);
      return db.listMaterialRequestTargetOptions(input.projectId, input.search);
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          status: z.string().optional(),
          requestedById: z.number().optional(),
          requestType: z.string().optional(),
          workflowStage: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const syncVisibleRows = async (
        rows: Awaited<ReturnType<typeof db.listMaterialRequests>>
      ) => {
        await Promise.all(
          rows.map(async (row) => {
            try {
              const result = await db.syncMaterialRequestFulfillmentStatus(
                row.request.id,
                user.id
              );
              if (result.changed) {
                row.request.status = result.status as any;
              }
            } catch (error) {
              console.warn(
                `No se pudo sincronizar la requisición ${row.request.id} al listar requisiciones`,
                error
              );
            }
          })
        );
        return input?.status
          ? rows.filter((row) => row.request.status === input.status)
          : rows;
      };

      if (user.buildreqRole === "ingeniero_residente") {
        const filters = applyProjectScope(input ?? {}, user);
        return syncVisibleRows(await db.listMaterialRequests({
          ...filters,
          requestedById: user.id,
        }));
      }
      if (user.buildreqRole === "administrador_proyecto") {
        return syncVisibleRows(
          await db.listMaterialRequests(applyProjectScope(input ?? {}, user))
        );
      }
      if (user.buildreqRole === "bodeguero_proyecto") {
        return syncVisibleRows(
          await db.listMaterialRequests(applyProjectScope(input ?? {}, user))
        );
      }
      if (user.buildreqRole === "superintendente") {
        return syncVisibleRows(
          await db.listMaterialRequests(applyProjectScope(input ?? {}, user))
        );
      }
      return syncVisibleRows(await db.listMaterialRequests(input ?? undefined));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const initial = await db.getMaterialRequestById(input.id);
      if (!initial) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      await db.syncMaterialRequestFulfillmentStatus(input.id, ctx.user.id);
      const result = await db.getMaterialRequestById(input.id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      if (!canAccessRequest(ctx.user, result.request)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta solicitud" });
      }
      if (ctx.user.buildreqRole === "ingeniero_residente") {
        return hideWarehouseStockQuantities(result);
      }
      return result;
    }),

  create: protectedProcedure
    .input(createMaterialRequestInput)
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      const {
        items,
        saveMode: _saveMode,
        neededBy: _neededBy,
        recipient: _recipient,
        ...requestData
      } = input;
      assertProjectScopedCreation(ctx.user, input.projectId);
      const completeItems = getCompleteRequestItems(items);
      const resolvedItems = await resolveRequestItemTargets(
        input.projectId,
        completeItems
      );
      const itemsForPersistence = buildRequestItemsForPersistence({
        requestType: input.requestType,
        saveMode: input.saveMode,
        items: resolvedItems,
      });
      const defaults = resolveMaterialRequestDefaults(input);

      const result = await db.createMaterialRequest(
        {
          ...requestData,
          recipient: defaults.recipient,
          requestedById: ctx.user.id,
          neededBy: defaults.resolvedNeededBy,
          notes: input.notes?.trim() || null,
          status: defaults.status,
          workflowStage: defaults.workflowStage,
          approvalStatus: defaults.approvalStatus,
        },
        itemsForPersistence
      );

      if (input.saveMode === "submit") {
        await notifyMaterialRequestSubmitted({
          requestId: result.id,
          requestNumber: result.requestNumber,
          projectId: input.projectId,
          requestType: input.requestType,
          purchaseUrgency: input.purchaseUrgency,
          resolvedNeededBy: defaults.resolvedNeededBy,
          requestedById: ctx.user.id,
        });
      }

      return {
        ...result,
        status: defaults.status,
      };
    }),

  update: protectedProcedure
    .input(
      createMaterialRequestInput.safeExtend({
        id: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      const detail = await db.getMaterialRequestById(input.id);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      if (!canEditRequestDraft(ctx.user, detail)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Esta requisición ya no se puede editar",
        });
      }

      assertProjectScopedCreation(ctx.user, input.projectId);

      const completeItems = getCompleteRequestItems(input.items);
      const resolvedItems = await resolveRequestItemTargets(
        input.projectId,
        completeItems
      );
      const itemsForPersistence = buildRequestItemsForPersistence({
        requestType: input.requestType,
        saveMode: input.saveMode,
        items: resolvedItems,
      });
      const defaults = resolveMaterialRequestDefaults(input);
      const nextStatus =
        input.saveMode === "draft"
          ? "borrador"
          : detail.request.status === "borrador"
          ? "pendiente_aprobar"
          : detail.request.status;

      await db.updateMaterialRequest(input.id, {
        projectId: input.projectId,
        requestType: input.requestType,
        recipient: defaults.recipient,
        purchaseUrgency: input.purchaseUrgency,
        neededBy: defaults.resolvedNeededBy,
        notes: input.notes?.trim() || null,
        status: nextStatus,
        workflowStage: defaults.workflowStage,
        approvalStatus: defaults.approvalStatus,
      });
      await db.replaceRequestItems(input.id, itemsForPersistence);

      if (detail.request.status === "borrador" && input.saveMode === "submit") {
        await notifyMaterialRequestSubmitted({
          requestId: input.id,
          requestNumber: detail.request.requestNumber,
          projectId: input.projectId,
          requestType: input.requestType,
          purchaseUrgency: input.purchaseUrgency,
          resolvedNeededBy: defaults.resolvedNeededBy,
          requestedById: detail.request.requestedById,
        });
      }

      return {
        id: input.id,
        requestNumber: detail.request.requestNumber,
        status: nextStatus,
      };
    }),

  reviewItems: protectedProcedure
    .input(
      z
        .object({
          requestId: z.number(),
          itemIds: z.array(z.number()).min(1),
          decision: z.enum(["aprobada", "rechazada"]),
          reason: z.string().trim().optional(),
        })
        .superRefine((value, ctx) => {
          if (
            value.decision === "rechazada" &&
            (!value.reason || value.reason.trim().length < 5)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["reason"],
              message: "Escriba un motivo de rechazo de al menos 5 caracteres",
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      if (!canApproveRequestAuthorization(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto pueden autorizar los ítems",
        });
      }

      const detail = await db.getMaterialRequestById(input.requestId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      if (!canAccessRequest(ctx.user, detail.request)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta solicitud" });
      }
      if (detail.request.requestType !== "bienes") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La autorización por ítem aplica solo a requisiciones de bienes",
        });
      }
      if (
        detail.request.status === "borrador" ||
        detail.request.status === "flujo_completado" ||
        detail.request.status === "cerrada" ||
        detail.request.status === "cerrada_incompleta"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La requisición no está disponible para autorización",
        });
      }

      const requestedIds = Array.from(new Set(input.itemIds));
      const itemsToReview = detail.items.filter((item) => requestedIds.includes(item.id));
      if (itemsToReview.length !== requestedIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Uno o más ítems ya no existen en la requisición",
        });
      }

      const invalidItem = itemsToReview.find((item) => {
        const hasMovement =
          Number(item.deliveredQuantity ?? 0) > 0 || Number(item.dispatchedQuantity ?? 0) > 0;
        return (
          item.approvalStatus !== "pendiente" ||
          Boolean(item.assignedFlow) ||
          Boolean(item.sapItemCode) ||
          hasMovement
        );
      });
      if (invalidItem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `El ítem ${invalidItem.itemName} ya no está pendiente de autorización`,
        });
      }

      const summary = await db.reviewMaterialRequestItems({
        requestId: input.requestId,
        itemIds: requestedIds,
        approvalStatus: input.decision,
        approvedById: ctx.user.id,
        rejectionReason: input.reason,
      });

      if (summary.pendingCount === 0 && summary.approvedCount > 0) {
        const [centralBodegaUsers, projectBodegaUsers] = await Promise.all([
          db.getUsersByBuildreqRole("jefe_bodega_central"),
          db.getUsersByBuildreqRoleAndProject(
            "bodeguero_proyecto",
            detail.request.projectId
          ),
        ]);
        const bodegaUsers = Array.from(
          new Map(
            [...centralBodegaUsers, ...projectBodegaUsers].map((user) => [
              user.id,
              user,
            ])
          ).values()
        );
        for (const bodegaUser of bodegaUsers) {
          await db.createNotification({
            userId: bodegaUser.id,
            title:
              summary.rejectedCount > 0
                ? "Requisición autorizada parcialmente"
                : "Requisición autorizada",
            message:
              summary.rejectedCount > 0
                ? `La requisición ${detail.request.requestNumber} ya fue revisada. Hay ítems aprobados para traducir/asignar flujo y ${summary.rejectedCount} ítem(s) rechazado(s).`
                : `La requisición ${detail.request.requestNumber} ya fue autorizada y puede pasar a traducción SAP y asignación de flujos.`,
            type: "nueva_solicitud",
            relatedEntityType: "material_request",
            relatedEntityId: input.requestId,
          });
        }
      }

      if (summary.pendingCount === 0) {
        await db.createNotification({
          userId: detail.request.requestedById,
          title:
            summary.approvedCount > 0
              ? summary.rejectedCount > 0
                ? "Requisición autorizada parcialmente"
                : "Requisición autorizada"
              : "Requisición rechazada",
          message:
            summary.approvedCount > 0
              ? summary.rejectedCount > 0
                ? `La requisición ${detail.request.requestNumber} fue revisada. Algunos ítems fueron autorizados y otros rechazados.`
                : `La requisición ${detail.request.requestNumber} fue autorizada y pasó a Bodega para su procesamiento.`
              : `La requisición ${detail.request.requestNumber} fue rechazada.`,
          type: "cambio_estatus",
          relatedEntityType: "material_request",
          relatedEntityId: input.requestId,
        });
      }

      return summary;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum([
          "borrador",
          "pendiente_aprobar",
          "en_espera",
          "en_proceso",
          "parcialmente_atendida",
          "flujo_completado",
          "cerrada",
          "cerrada_incompleta",
          "anulada",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      if (
        ctx.user.buildreqRole === "ingeniero_residente" ||
        ctx.user.buildreqRole === "bodeguero_proyecto"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cambiar el estatus",
        });
      }

      const result = await db.updateMaterialRequestStatus(
        input.id,
        input.status,
        ctx.user.id
      );

      // Notify the requesting engineer
      const request = await db.getMaterialRequestById(input.id);
      if (request) {
        const statusLabels: Record<string, string> = {
          borrador: "Borrador",
          pendiente_aprobar: "Pendiente de aprobar",
          en_espera: "En espera",
          en_proceso: "En proceso de atención",
          parcialmente_atendida: "Parcialmente atendida",
          flujo_completado: "Flujo completado",
          cerrada: "Cerrada",
          cerrada_incompleta: "Cerrada incompleta",
          anulada: "Anulada",
        };
        await db.createNotification({
          userId: request.request.requestedById,
          title: "Cambio de estatus en requisición",
          message: `La requisición ${request.request.requestNumber} cambió a: ${statusLabels[input.status]}`,
          type: "cambio_estatus",
          relatedEntityType: "material_request",
          relatedEntityId: input.id,
        });
      }

      return result;
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      if (!canApproveRequestAuthorization(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto pueden aprobar servicios",
        });
      }

      const request = await db.getMaterialRequestById(input.id);
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      if (!canAccessRequest(ctx.user, request.request)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta solicitud" });
      }
      if (request.request.requestType !== "servicios") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo las requisiciones de servicios requieren esta aprobación",
        });
      }

      await db.approveMaterialRequest(input.id, ctx.user.id);
      await db.createNotification({
        userId: request.request.requestedById,
        title: "Requisición aprobada",
        message: `La requisición ${request.request.requestNumber} fue aprobada y enviada a Oficina Central.`,
        type: "cambio_estatus",
        relatedEntityType: "material_request",
        relatedEntityId: input.id,
      });
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      if (!canApproveRequestAuthorization(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo el Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto pueden rechazar servicios",
        });
      }

      const request = await db.getMaterialRequestById(input.id);
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      if (!canAccessRequest(ctx.user, request.request)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta solicitud" });
      }

      await db.rejectMaterialRequest(input.id, ctx.user.id, input.reason);
      await db.createNotification({
        userId: request.request.requestedById,
        title: "Requisición rechazada",
        message: `La requisición ${request.request.requestNumber} fue rechazada. Motivo: ${input.reason}`,
        type: "cambio_estatus",
        relatedEntityType: "material_request",
        relatedEntityId: input.id,
      });
      return { success: true };
    }),

  assignFlow: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
        flowType: z.enum([
          "compra_directa",
          "despacho_bodega",
          "traslado_proyecto",
          "solicitud_compra",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      if (
        ctx.user.buildreqRole === "ingeniero_residente" ||
        ctx.user.buildreqRole === "administrador_proyecto"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para asignar flujos",
        });
      }
      const request = await db.getMaterialRequestById(input.requestId);
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }
      if (!canAccessRequest(ctx.user, request.request)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta solicitud" });
      }
      if (
        ctx.user.buildreqRole === "bodeguero_proyecto" &&
        ![
          "compra_directa",
          "despacho_bodega",
          "traslado_proyecto",
          "solicitud_compra",
        ].includes(input.flowType)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "El Bodeguero de Proyecto solo puede enviar requisiciones a flujos de su proyecto",
        });
      }
      if (
        request.request.requestType === "bienes" &&
        request.request.approvalStatus === "pendiente"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La requisición todavía está pendiente de autorización del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto.",
        });
      }
      return db.assignFlow(input.requestId, input.flowType, ctx.user.id);
    }),

  sendToSap: protectedProcedure
    .input(z.object({ requestId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      assertNotSuperintendentReadOnly(ctx.user);
      if (
        ctx.user.buildreqRole === "ingeniero_residente" ||
        ctx.user.buildreqRole === "bodeguero_proyecto"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para enviar a SAP",
        });
      }

      const request = await db.getMaterialRequestById(input.requestId);
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requisición no encontrada" });
      }

      const pendingApprovalItems = request.items.filter(
        (item) => item.approvalStatus === "pendiente"
      );
      if (pendingApprovalItems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La requisición todavía tiene ítems pendientes de autorización del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto.",
        });
      }

      // Verify all items have flows and SAP codes assigned
      const approvedItems = request.items.filter(
        (item) => item.approvalStatus !== "rechazada"
      );
      const unassignedItems = approvedItems.filter(
        (item) => !item.assignedFlow || !item.sapItemCode
      );
      if (unassignedItems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Hay ${unassignedItems.length} ítem(s) sin flujo o código SAP asignado. Complete todos los ítems antes de enviar a SAP.`,
        });
      }

      // Create SAP sync log entries for each item's flow
      const sapDocTypeMap: Record<string, string> = {
        despacho_bodega: "Salida de Inventario",
        solicitud_compra: "Solicitud de Compra",
        traslado_proyecto: "Solicitud de Transferencia",
        compra_directa: "Orden de Compra", // First step for compra_directa
      };

      for (const item of approvedItems) {
        await db.createSapSyncLog({
          entityType: "supply_flow",
          entityId: input.requestId,
          sapDocumentType: sapDocTypeMap[item.assignedFlow!] || "Desconocido",
          status: "pending",
          requestPayload: JSON.stringify({
            requestNumber: request.request.requestNumber,
            itemCode: item.sapItemCode,
            itemDescription: item.sapItemDescription || item.itemName,
            quantity: item.quantity,
            unit: item.unit,
            flow: item.assignedFlow,
            projectCode: request.project?.code,
          }),
        });
      }

      await db.updateMaterialRequestStatus(input.requestId, "en_proceso", ctx.user.id);

      // Notify the requesting engineer
      await db.createNotification({
        userId: request.request.requestedById,
        title: "Requisición enviada a SAP",
        message: `La requisición ${request.request.requestNumber} ha sido procesada y enviada a SAP.`,
        type: "cambio_estatus",
        relatedEntityType: "material_request",
        relatedEntityId: input.requestId,
      });

      return { success: true, itemsProcessed: approvedItems.length };
    }),
});
