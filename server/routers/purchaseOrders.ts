import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import {
  PURCHASE_ORDER_CONTRACT_FREQUENCIES,
} from "@shared/purchase-orders";
import { ASSET_CONDITION_VALUES } from "@shared/fixed-assets";

const RECEIVABLE_PURCHASE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
]);

const UNIFIED_PURCHASE_REQUEST_STATUSES = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
  "parcialmente_convertida",
]);

const quantityToConvertSchema = z.object({
  purchaseRequestItemId: z.number(),
  quantity: z
    .string()
    .trim()
    .min(1)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
      message: "La cantidad a convertir debe ser mayor que cero",
    }),
  unitPrice: z
    .string()
    .trim()
    .min(1)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
      message: "El precio unitario debe ser un número válido",
    })
    .optional(),
  taxCode: z.string().trim().min(1).optional(),
  additionalTaxCodes: z.array(z.string().trim().min(1)).optional(),
});

function toDecimalString(value: string | number | null | undefined) {
  const parsed =
    value === null || value === undefined || value === ""
      ? 0
      : Number(value);
  return (Number.isFinite(parsed) ? parsed : 0).toFixed(2);
}

function parseDateInput(value?: string | null) {
  return value ? new Date(`${value}T12:00:00`) : null;
}

function dateKey(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

const contractFieldsBaseSchema = z.object({
  appliesContract: z.boolean().optional(),
  contractPaymentFrequency: z
    .enum(PURCHASE_ORDER_CONTRACT_FREQUENCIES)
    .optional()
    .nullable(),
  contractFirstPaymentDate: z.string().optional().nullable(),
  contractEndDate: z.string().optional().nullable(),
  contractNote: z.string().trim().max(500).optional().nullable(),
});

function validateContractFields(
  value: z.infer<typeof contractFieldsBaseSchema>,
  ctx: z.RefinementCtx
) {
  if (!value.appliesContract) return;
  if (!value.contractPaymentFrequency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contractPaymentFrequency"],
      message: "Seleccione la frecuencia de pago del contrato",
    });
  }
  if (!value.contractFirstPaymentDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contractFirstPaymentDate"],
      message: "Seleccione la primera fecha de pago del contrato",
    });
  }
  if (!value.contractEndDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contractEndDate"],
      message: "Seleccione la fecha de terminación del contrato",
    });
  }
  const firstDate = parseDateInput(value.contractFirstPaymentDate);
  const endDate = parseDateInput(value.contractEndDate);
  if (firstDate && endDate && endDate < firstDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contractEndDate"],
      message:
        "La fecha de terminación no puede ser anterior a la primera fecha de pago",
    });
  }
}

const contractFieldsSchema =
  contractFieldsBaseSchema.superRefine(validateContractFields);

const fixedAssetDetailSchema = z.object({
  serialNumber: z.string().trim().min(1).max(120),
  condition: z.enum(ASSET_CONDITION_VALUES),
  color: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  chassisSeries: z.string().trim().max(120).nullish(),
  motorSeries: z.string().trim().max(120).nullish(),
  plateOrCode: z.string().trim().max(120).nullish(),
});

function getPendingConversionQuantity(item: {
  quantity: string | number | null | undefined;
  convertedQuantity?: string | number | null | undefined;
  pendingConversionQuantity?: string | number | null | undefined;
}) {
  if (item.pendingConversionQuantity !== undefined && item.pendingConversionQuantity !== null) {
    return Math.max(Number(item.pendingConversionQuantity), 0);
  }
  return Math.max(
    Number(item.quantity ?? 0) - Number(item.convertedQuantity ?? 0),
    0
  );
}

function canAccessPurchaseOrders(user: {
  role: string;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "jefe_bodega_central"
  );
}

function canConvertPurchaseRequestToOrder(user: {
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
  },
  projectId: number
) {
  if (user.role === "admin") return;
  if (
    (user.buildreqRole === "administrador_proyecto" ||
      user.buildreqRole === "bodeguero_proyecto") &&
    user.assignedProjectId !== projectId
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a órdenes de compra de otro proyecto",
    });
  }
}

function assertProjectAdminCanConvertPurchaseType(
  user: { buildreqRole?: string | null },
  purchaseType?: string | null
) {
  if (
    user.buildreqRole === "administrador_proyecto" &&
    purchaseType !== "compra_directa"
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "El Administrador del Proyecto solo puede convertir a OC solicitudes de compra directa",
    });
  }
}

function assertCanModifyPurchaseOrders(user: {
  buildreqRole?: string | null;
}) {
  if (user.buildreqRole === "bodeguero_proyecto") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "El Bodeguero de Proyecto solo puede consultar órdenes de compra",
    });
  }
}

function assertPurchaseOrderEditable(status: string) {
  if (status === "anulada") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La orden de compra ya está anulada",
    });
  }
}

function assertPurchaseOrderMutable(status: string) {
  assertPurchaseOrderEditable(status);

  if (status === "recibida") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue recibida y solo está disponible en modo lectura",
    });
  }
}

function assertPurchaseOrderStructureEditable(status?: string | null) {
  assertPurchaseOrderEditable(status ?? "borrador");

  if (!status || status === "borrador") {
    return;
  }

  if (status === "recibida") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue recibida y solo está disponible en modo lectura",
    });
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      "La orden de compra ya fue emitida y no permite editar lineas ni proveedor",
  });
}

async function releaseDirectPurchaseRequestItems(
  materialRequestItemIds: Array<number | null | undefined>,
  userId: number,
  note: string
) {
  const affectedRequestIds = new Set<number>();

  for (const materialRequestItemId of materialRequestItemIds) {
    if (!materialRequestItemId) continue;

    const requestItem = await db.getRequestItemById(materialRequestItemId);
    if (!requestItem || requestItem.assignedFlow !== "compra_directa") continue;

    affectedRequestIds.add(requestItem.requestId);
    await db.updateRequestItem(requestItem.id, {
      assignedFlow: null,
      status: "pendiente",
    });

    const activeFlow = await db.getActiveSupplyFlowForRequestItem({
      requestId: requestItem.requestId,
      requestItemId: requestItem.id,
      flowType: "compra_directa",
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

async function releaseDirectPurchaseOrderItems(params: {
  purchaseOrderNumber: string;
  userId: number;
  note: string;
  sapItemCode?: string | null;
}) {
  const flowItems = await db.listDirectPurchaseFlowItemsByOrder({
    purchaseOrderNumber: params.purchaseOrderNumber,
    sapItemCode: params.sapItemCode,
  });

  await releaseDirectPurchaseRequestItems(
    flowItems.map(entry => entry.item.id),
    params.userId,
    params.note
  );
}

export const purchaseOrdersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          classification: z.enum(["oc", "cd"]).optional(),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a órdenes de compra",
        });
      }

      const projectId =
        ctx.user.buildreqRole === "administrador_proyecto" ||
        ctx.user.buildreqRole === "bodeguero_proyecto"
          ? (ctx.user.assignedProjectId ?? -1)
          : input?.projectId;

      return db.listPurchaseOrders({
        ...input,
        projectId,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a órdenes de compra",
        });
      }

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      return detail;
    }),

  latestSupplierPrices: protectedProcedure
    .input(
      z.object({
        supplierId: z.number(),
        sapCodes: z.array(z.string().trim().min(1)).min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a órdenes de compra",
        });
      }

      return db.getLatestSupplierPurchasePrices({
        supplierId: input.supplierId,
        sapCodes: input.sapCodes,
        projectId:
          ctx.user.buildreqRole === "administrador_proyecto" ||
          ctx.user.buildreqRole === "bodeguero_proyecto"
            ? (ctx.user.assignedProjectId ?? -1)
            : undefined,
      });
    }),

  createFromPurchaseRequest: protectedProcedure
    .input(
      z
        .object({
          purchaseRequestId: z.number(),
          selectedItemIds: z.array(z.number()).optional(),
          itemsToConvert: z.array(quantityToConvertSchema).optional(),
          classification: z.enum(["oc", "cd"]).default("oc"),
          supplierId: z.number().optional(),
          supplierEmail: z.string().email().optional(),
          notes: z.string().optional(),
        })
        .merge(contractFieldsBaseSchema)
        .superRefine(validateContractFields)
    )
    .mutation(async ({ ctx, input }) => {
      if (!canConvertPurchaseRequestToOrder(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o el Administrador del Proyecto puede convertir SC a OC",
        });
      }

      const detail = await db.getPurchaseRequestById(input.purchaseRequestId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
      assertProjectAdminCanConvertPurchaseType(
        ctx.user,
        detail.purchaseRequest.purchaseType
      );

      if (detail.purchaseRequest.status === "convertida") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La solicitud de compra ya fue convertida y solo está disponible en modo lectura",
        });
      }

      const itemById = new Map(
        (detail.items ?? []).map((item: any) => [item.id, item])
      );
      const requestedConversions: Array<{
        purchaseRequestItemId: number;
        quantity: string;
        unitPrice?: string;
        taxCode?: string;
        additionalTaxCodes?: string[];
      }> =
        input.itemsToConvert && input.itemsToConvert.length > 0
          ? input.itemsToConvert
          : (input.selectedItemIds ?? []).map((id) => {
              const item = itemById.get(id);
              return {
                purchaseRequestItemId: id,
                quantity: toDecimalString(
                  item ? getPendingConversionQuantity(item) : 0
                ),
              };
            });

      if (requestedConversions.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe seleccionar al menos un ítem para la OC",
        });
      }

      const conversionQuantityByItemId = new Map<number, number>();
      const conversionDraftByItemId = new Map<
        number,
        { unitPrice?: string; taxCode?: string; additionalTaxCodes?: string[] }
      >();
      for (const conversion of requestedConversions) {
        conversionQuantityByItemId.set(
          conversion.purchaseRequestItemId,
          (conversionQuantityByItemId.get(conversion.purchaseRequestItemId) ??
            0) + Number(conversion.quantity)
        );
        conversionDraftByItemId.set(conversion.purchaseRequestItemId, {
          unitPrice: conversion.unitPrice,
          taxCode: conversion.taxCode,
          additionalTaxCodes: conversion.additionalTaxCodes,
        });
      }

      const conversionItems = Array.from(
        conversionQuantityByItemId.entries()
      ).map(([purchaseRequestItemId, requestedQuantity]) => {
        const item = itemById.get(purchaseRequestItemId);
        if (!item) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uno de los ítems no pertenece a la solicitud de compra",
          });
        }

        const pendingQuantity = getPendingConversionQuantity(item);
        const quantityToConvert = requestedQuantity;
        if (pendingQuantity <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El ítem ${item.itemName} no tiene saldo pendiente por convertir`,
          });
        }
        if (quantityToConvert > pendingQuantity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La cantidad a convertir de ${item.itemName} excede el saldo pendiente`,
          });
        }

        return {
          item,
          quantityToConvert: toDecimalString(quantityToConvert),
          unitPrice: conversionDraftByItemId.get(purchaseRequestItemId)
            ?.unitPrice,
          taxCode: conversionDraftByItemId.get(purchaseRequestItemId)?.taxCode,
          additionalTaxCodes:
            conversionDraftByItemId.get(purchaseRequestItemId)
              ?.additionalTaxCodes,
        };
      });

      const directPurchaseRequestItemIds = conversionItems
        .map(({ item }) => item)
        .map((item: any) => item.materialRequestItemId)
        .filter(
          (value: number | null | undefined): value is number =>
            typeof value === "number"
        );
      const directPurchaseFlowItems =
        directPurchaseRequestItemIds.length > 0
          ? await db.listDirectPurchaseFlowItemsByOrder({
              purchaseOrderNumber: detail.purchaseRequest.requestNumber,
              requestItemIds: directPurchaseRequestItemIds,
            })
          : [];
      const directPurchaseFlowByRequestItemId = new Map<number, any[]>();
      for (const linkedFlowItem of directPurchaseFlowItems) {
        const requestItemId = linkedFlowItem.item?.id;
        if (!requestItemId) continue;
        const current =
          directPurchaseFlowByRequestItemId.get(requestItemId) ?? [];
        current.push(linkedFlowItem);
        directPurchaseFlowByRequestItemId.set(requestItemId, current);
      }

      const selectedItemsByProject = new Map<number, any[]>();
      for (const conversionItem of conversionItems) {
        const { item } = conversionItem;
        const sourceProjectId =
          item.sourceProject?.id ?? detail.purchaseRequest.projectId;
        assertProjectScopedAccess(ctx.user, sourceProjectId);
        const current = selectedItemsByProject.get(sourceProjectId) ?? [];
        current.push(conversionItem);
        selectedItemsByProject.set(sourceProjectId, current);
      }

      const createdOrders: Array<{
        projectId: number;
        purchaseOrderId: number;
        purchaseOrderNumber: string;
      }> = [];

      for (const [projectId, projectItems] of Array.from(
        selectedItemsByProject.entries()
      )) {
        const projectFlowItems = projectItems.flatMap(({ item }: any) =>
          item.materialRequestItemId
            ? (directPurchaseFlowByRequestItemId.get(
                item.materialRequestItemId
              ) ?? [])
            : []
        );
        const inferredClassification =
          projectFlowItems.length > 0 ? "cd" : input.classification;
        const inferredSupplierId =
          input.supplierId ??
          projectFlowItems[0]?.flow?.supplierId ??
          undefined;

        const created = await db.createPurchaseOrder(
          {
            purchaseRequestId: detail.purchaseRequest.id,
            projectId,
            classification: inferredClassification,
            purchaseType: detail.purchaseRequest.purchaseType,
            supplierId: inferredSupplierId,
            supplierEmail: input.supplierEmail,
            status: "borrador",
            neededBy: detail.purchaseRequest.neededBy,
            sapDocumentNumber: detail.purchaseRequest.sapDocumentNumber,
            notes: input.notes ?? detail.purchaseRequest.notes ?? undefined,
            printedDocumentName: null,
            printedDocumentMimeType: null,
            printedDocumentContent: null,
            printedAt: null,
            emailStatus: "pendiente",
            emailedAt: null,
            emailError: null,
            appliesContract: input.appliesContract ?? false,
            contractPaymentFrequency: input.appliesContract
              ? input.contractPaymentFrequency
              : null,
            contractFirstPaymentDate: input.appliesContract
              ? parseDateInput(input.contractFirstPaymentDate)
              : null,
            contractEndDate: input.appliesContract
              ? parseDateInput(input.contractEndDate)
              : null,
            contractExpiryNotifiedAt: null,
            createdById: ctx.user.id,
          },
          projectItems.map(({ item, quantityToConvert, unitPrice, taxCode, additionalTaxCodes }: any) => ({
            purchaseRequestItemId: item.id,
            materialRequestItemId: item.materialRequestItemId,
            originalSapItemCode: item.originalSapItemCode,
            currentSapItemCode: item.currentSapItemCode,
            itemName: item.itemName,
            quantity: quantityToConvert,
            receivedQuantity: "0.00",
            unit: item.unit,
            unitPrice: unitPrice ?? item.unitPrice ?? "0.00",
            taxCode: taxCode ?? "exe",
            additionalTaxCodes,
            notes: item.notes,
          }))
        );

        createdOrders.push({
          projectId,
          purchaseOrderId: created.id,
          purchaseOrderNumber: created.orderNumber,
        });

        const updatedFlowIds = new Set<number>();
        for (const linkedFlowItem of projectFlowItems) {
          if (updatedFlowIds.has(linkedFlowItem.flow.id)) continue;
          updatedFlowIds.add(linkedFlowItem.flow.id);

          await db.updateSupplyFlowRecord(linkedFlowItem.flow.id, {
            purchaseOrderNumber: created.orderNumber,
            sapDocumentType: "orden_compra",
            status: "en_proceso",
            notes: input.notes ?? linkedFlowItem.flow.notes ?? undefined,
          });
        }
      }

      for (const { item, quantityToConvert } of conversionItems) {
        await db.adjustPurchaseRequestItemConvertedQuantity(
          item.id,
          quantityToConvert
        );
      }
      await db.syncPurchaseRequestConversionStatus(input.purchaseRequestId);

      if (createdOrders.length === 1) {
        return {
          success: true,
          purchaseOrderId: createdOrders[0].purchaseOrderId,
          purchaseOrderNumber: createdOrders[0].purchaseOrderNumber,
        };
      }

      return {
        success: true,
        purchaseOrders: createdOrders,
      };
    }),

  createUnifiedFromPurchaseRequests: protectedProcedure
    .input(
      z
        .object({
          purchaseRequestIds: z.array(z.number()).min(2),
          classification: z.enum(["oc", "cd"]).default("oc"),
          supplierId: z.number().optional(),
          supplierEmail: z.string().email().optional(),
          notes: z.string().optional(),
        })
        .merge(contractFieldsBaseSchema)
        .superRefine(validateContractFields)
    )
    .mutation(async ({ ctx, input }) => {
      if (!canConvertPurchaseRequestToOrder(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Solo Administración Central o el Administrador del Proyecto puede convertir SC a OC",
        });
      }

      const purchaseRequestIds = Array.from(new Set(input.purchaseRequestIds));
      if (purchaseRequestIds.length < 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione al menos dos solicitudes de compra",
        });
      }

      const details = await Promise.all(
        purchaseRequestIds.map((id) => db.getPurchaseRequestById(id))
      );

      const missingIndex = details.findIndex((detail) => !detail);
      if (missingIndex >= 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Una de las solicitudes de compra no fue encontrada",
        });
      }

      const purchaseRequests = details as Array<NonNullable<typeof details[number]>>;
      for (const detail of purchaseRequests) {
        assertProjectScopedAccess(ctx.user, detail.purchaseRequest.projectId);
        assertProjectAdminCanConvertPurchaseType(
          ctx.user,
          detail.purchaseRequest.purchaseType
        );
      }

      const blockedRequest = purchaseRequests.find(
        (detail) =>
          !UNIFIED_PURCHASE_REQUEST_STATUSES.has(
            detail.purchaseRequest.status
          )
      );
      if (blockedRequest) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La ${blockedRequest.purchaseRequest.requestNumber} no puede unificarse porque está ${blockedRequest.purchaseRequest.status}`,
        });
      }

      const purchaseTypes = new Set(
        purchaseRequests.map((detail) => detail.purchaseRequest.purchaseType)
      );
      if (purchaseTypes.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden unificar solicitudes con el mismo tipo de compra",
        });
      }

      const allItems = purchaseRequests.flatMap((detail) =>
        (detail.items ?? [])
          .filter((item: any) => getPendingConversionQuantity(item) > 0)
          .map((item: any) => ({
            detail,
            item,
            quantityToConvert: toDecimalString(getPendingConversionQuantity(item)),
            sourceProjectId:
              item.sourceProject?.id ?? detail.purchaseRequest.projectId,
          }))
      );
      if (allItems.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Las solicitudes seleccionadas no tienen ítems",
        });
      }

      const sourceProjectIds = new Set(
        allItems.map((entry) => entry.sourceProjectId)
      );
      for (const projectId of Array.from(sourceProjectIds)) {
        assertProjectScopedAccess(ctx.user, projectId);
      }

      if (sourceProjectIds.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Seleccione solicitudes del mismo proyecto para crear una OC unificada",
        });
      }

      const directPurchaseFlowByRequestItemId = new Map<number, any[]>();
      for (const detail of purchaseRequests) {
        const directPurchaseRequestItemIds = (detail.items ?? [])
          .map((item: any) => item.materialRequestItemId)
          .filter(
            (value: number | null | undefined): value is number =>
              typeof value === "number"
          );
        const directPurchaseFlowItems =
          directPurchaseRequestItemIds.length > 0
            ? await db.listDirectPurchaseFlowItemsByOrder({
                purchaseOrderNumber: detail.purchaseRequest.requestNumber,
                requestItemIds: directPurchaseRequestItemIds,
              })
            : [];

        for (const linkedFlowItem of directPurchaseFlowItems) {
          const requestItemId = linkedFlowItem.item?.id;
          if (!requestItemId) continue;
          const current =
            directPurchaseFlowByRequestItemId.get(requestItemId) ?? [];
          current.push(linkedFlowItem);
          directPurchaseFlowByRequestItemId.set(requestItemId, current);
        }
      }

      const flowItems = allItems.flatMap(({ item }) =>
        item.materialRequestItemId
          ? (directPurchaseFlowByRequestItemId.get(item.materialRequestItemId) ??
            [])
          : []
      );
      const earliestNeededBy = purchaseRequests
        .map((detail) => detail.purchaseRequest.neededBy)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
      const requestNumbers = purchaseRequests
        .map((detail) => detail.purchaseRequest.requestNumber)
        .join(", ");

      const created = await db.createPurchaseOrder(
        {
          purchaseRequestId: null,
          projectId: Array.from(sourceProjectIds)[0],
          classification: flowItems.length > 0 ? "cd" : input.classification,
          purchaseType: purchaseRequests[0].purchaseRequest.purchaseType,
          supplierId: input.supplierId ?? flowItems[0]?.flow?.supplierId ?? null,
          supplierEmail: input.supplierEmail,
          status: "borrador",
          neededBy: earliestNeededBy,
          sapDocumentNumber: null,
          notes:
            input.notes ??
            `Orden de compra unificada desde solicitudes: ${requestNumbers}`,
          printedDocumentName: null,
          printedDocumentMimeType: null,
          printedDocumentContent: null,
          printedAt: null,
          emailStatus: "pendiente",
          emailedAt: null,
          emailError: null,
          appliesContract: input.appliesContract ?? false,
          contractPaymentFrequency: input.appliesContract
            ? input.contractPaymentFrequency
            : null,
          contractFirstPaymentDate: input.appliesContract
            ? parseDateInput(input.contractFirstPaymentDate)
            : null,
          contractEndDate: input.appliesContract
            ? parseDateInput(input.contractEndDate)
            : null,
          contractExpiryNotifiedAt: null,
          createdById: ctx.user.id,
        },
        allItems.map(({ item, quantityToConvert }) => ({
          purchaseRequestItemId: item.id,
          materialRequestItemId: item.materialRequestItemId,
          originalSapItemCode: item.originalSapItemCode,
          currentSapItemCode: item.currentSapItemCode,
          itemName: item.itemName,
          quantity: quantityToConvert,
          receivedQuantity: "0.00",
          unit: item.unit,
          unitPrice: item.unitPrice ?? "0.00",
          notes: item.notes,
        }))
      );

      const updatedFlowIds = new Set<number>();
      for (const linkedFlowItem of flowItems) {
        if (updatedFlowIds.has(linkedFlowItem.flow.id)) continue;
        updatedFlowIds.add(linkedFlowItem.flow.id);

        await db.updateSupplyFlowRecord(linkedFlowItem.flow.id, {
          purchaseOrderNumber: created.orderNumber,
          sapDocumentType: "orden_compra",
          status: "en_proceso",
          notes: input.notes ?? linkedFlowItem.flow.notes ?? undefined,
        });
      }

      for (const { item, quantityToConvert } of allItems) {
        await db.adjustPurchaseRequestItemConvertedQuantity(
          item.id,
          quantityToConvert
        );
      }

      for (const id of purchaseRequestIds) {
        await db.syncPurchaseRequestConversionStatus(id);
      }

      return {
        success: true,
        purchaseOrderId: created.id,
        purchaseOrderNumber: created.orderNumber,
        purchaseRequestIds,
        unifiedPurchaseRequestCount: purchaseRequestIds.length,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        supplierId: z.number().optional(),
        supplierContactId: z.number().nullable().optional(),
        supplierEmail: z.string().email().nullable().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar la OC",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(detail.purchaseOrder.status);

      if (input.supplierContactId) {
        const contact = await db.getSupplierContactById(input.supplierContactId);
        if (!contact || !contact.isActive) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Seleccione un contacto activo del proveedor",
          });
        }
        const supplierId = input.supplierId ?? detail.purchaseOrder.supplierId;
        if (
          contact.supplierId !== supplierId ||
          contact.projectId !== detail.purchaseOrder.projectId
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El contacto no pertenece a este proveedor/proyecto",
          });
        }
      }

      return db.updatePurchaseOrder(input.id, {
        supplierId: input.supplierId,
        supplierContactId: input.supplierContactId,
        supplierEmail: input.supplierEmail,
        notes: input.notes,
      });
    }),

  updateContractTerms: protectedProcedure
    .input(
      contractFieldsBaseSchema
        .extend({
          id: z.number(),
        })
        .superRefine(validateContractFields)
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para editar el contrato",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(detail.purchaseOrder.status);

      const isDraft = detail.purchaseOrder.status === "borrador";
      const isContractEditableAfterIssue =
        detail.purchaseOrder.appliesContract &&
        ["emitida", "enviada", "parcialmente_recibida"].includes(
          detail.purchaseOrder.status
        );
      if (!isDraft && !isContractEditableAfterIssue) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se puede editar contrato en borrador o la fecha de vencimiento de una OC contrato emitida",
        });
      }

      if (!isDraft) {
        const firstPaymentDate = parseDateInput(input.contractFirstPaymentDate);
        const sameFrequency =
          input.contractPaymentFrequency ===
          detail.purchaseOrder.contractPaymentFrequency;
        const sameFirstPaymentDate =
          dateKey(firstPaymentDate) ===
          dateKey(detail.purchaseOrder.contractFirstPaymentDate);
        if (
          input.appliesContract !== true ||
          !sameFrequency ||
          !sameFirstPaymentDate
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "En una OC contrato emitida solo se puede cambiar la fecha de terminación",
          });
        }
      }

      return db.updatePurchaseOrderContractTerms({
        purchaseOrderId: input.id,
        changedById: ctx.user.id,
        appliesContract: input.appliesContract ?? false,
        contractPaymentFrequency: input.appliesContract
          ? input.contractPaymentFrequency ?? null
          : null,
        contractFirstPaymentDate: input.appliesContract
          ? parseDateInput(input.contractFirstPaymentDate)
          : null,
        contractEndDate: input.appliesContract
          ? parseDateInput(input.contractEndDate)
          : null,
        note: input.contractNote,
      });
    }),

  replaceItem: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        currentSapItemCode: z.string().min(1),
        itemName: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para reemplazar ítems",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      return db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        currentSapItemCode: input.currentSapItemCode,
        itemName: input.itemName,
      });
    }),

  updateItemPricing: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        unitPrice: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) >= 0,
            {
              message: "El precio debe ser un numero valido",
            }
          ),
        taxCode: z.string().trim().min(1),
        additionalTaxCodes: z.array(z.string().trim().min(1)).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar montos de la OC",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      const taxData = await db.preparePurchaseOrderTaxDataForLine({
        quantity: itemDetail.item.quantity,
        unitPrice: input.unitPrice,
        taxCode: input.taxCode,
        additionalTaxCodes: input.additionalTaxCodes,
      });

      return db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        unitPrice: input.unitPrice,
        ...taxData,
      });
    }),

  updateItemLine: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        quantity: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) > 0,
            {
              message: "La cantidad debe ser un numero mayor que cero",
            }
          ),
        unitPrice: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) >= 0,
            {
              message: "El precio debe ser un numero valido",
            }
          ),
        taxCode: z.string().trim().min(1),
        additionalTaxCodes: z.array(z.string().trim().min(1)).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar lineas de la OC",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      const receivedQuantity = Number(itemDetail.item.receivedQuantity ?? 0);
      const nextQuantity = Number(input.quantity);
      if (nextQuantity < receivedQuantity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La cantidad no puede ser menor a lo ya recibido",
        });
      }

      if (
        itemDetail.item.purchaseRequestItemId &&
        nextQuantity !== Number(itemDetail.item.quantity ?? 0)
      ) {
        const purchaseRequestItem = await db.getPurchaseRequestItemById(
          itemDetail.item.purchaseRequestItemId
        );
        if (purchaseRequestItem) {
          const currentLineQuantity = Number(itemDetail.item.quantity ?? 0);
          const availableForLine =
            Number(purchaseRequestItem.quantity ?? 0) -
            Number(purchaseRequestItem.convertedQuantity ?? 0) +
            currentLineQuantity;
          if (nextQuantity > availableForLine) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La cantidad excede el saldo pendiente de la solicitud de compra",
            });
          }
        }
      }

      const taxData = await db.preparePurchaseOrderTaxDataForLine({
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        taxCode: input.taxCode,
        additionalTaxCodes: input.additionalTaxCodes,
      });

      await db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        ...taxData,
      });

      if (
        itemDetail.item.purchaseRequestItemId &&
        nextQuantity !== Number(itemDetail.item.quantity ?? 0)
      ) {
        const delta = nextQuantity - Number(itemDetail.item.quantity ?? 0);
        const purchaseRequestItem =
          await db.adjustPurchaseRequestItemConvertedQuantity(
            itemDetail.item.purchaseRequestItemId,
            delta
          );
        await db.syncPurchaseRequestConversionStatus(
          purchaseRequestItem.purchaseRequestId
        );
      }

      return { success: true };
    }),

  saveFixedAssetDraftLine: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number().int().positive(),
        isLeasing: z.boolean().optional(),
        lineObservation: z.string().trim().max(1000).optional(),
        assetDetail: fixedAssetDetailSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para guardar activos fijos",
        });
      }

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderMutable(itemDetail.purchaseOrder.status);

      try {
        return await db.savePurchaseOrderFixedAssetDraftLine(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo guardar el activo fijo",
        });
      }
    }),

  updateContractItemPrice: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        unitPrice: z
          .string()
          .trim()
          .min(1)
          .refine(
            value => Number.isFinite(Number(value)) && Number(value) >= 0,
            {
              message: "El precio debe ser un numero valido",
            }
          ),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para actualizar precios de contrato",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(itemDetail.purchaseOrder.status);

      if (
        !itemDetail.purchaseOrder.appliesContract ||
        !["emitida", "enviada", "parcialmente_recibida"].includes(
          itemDetail.purchaseOrder.status
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se puede editar el precio en una OC contrato emitida",
        });
      }

      if (Number(input.unitPrice) === Number(itemDetail.item.unitPrice ?? 0)) {
        return { success: true };
      }

      await db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        unitPrice: input.unitPrice,
      });
      await db.createPurchaseOrderAuditLog({
        purchaseOrderId: itemDetail.purchaseOrder.id,
        purchaseOrderItemId: itemDetail.item.id,
        action: "actualizar_precio_contrato",
        field: "unitPrice",
        oldValue: String(itemDetail.item.unitPrice ?? "0.00"),
        newValue: input.unitPrice,
        changedById: ctx.user.id,
        note: input.note?.trim() || null,
      });

      return { success: true };
    }),

  closeReceiptLine: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cerrar líneas de recepción",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }

      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderMutable(itemDetail.purchaseOrder.status);

      if (
        !RECEIVABLE_PURCHASE_ORDER_STATUSES.has(itemDetail.purchaseOrder.status)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden cerrar líneas de órdenes con recepciones pendientes",
        });
      }

      if (itemDetail.item.receiptClosed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La línea ya fue cerrada en recepción",
        });
      }

      const orderedQuantity = Number(itemDetail.item.quantity ?? 0);
      const receivedQuantity = Number(itemDetail.item.receivedQuantity ?? 0);

      if (!(receivedQuantity > 0 && receivedQuantity < orderedQuantity)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden cerrar líneas que estén parcialmente recibidas",
        });
      }

      await db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        receiptClosed: true,
        receiptClosedAt: new Date(),
        receiptClosedById: ctx.user.id,
        receiptCloseNote: input.note?.trim() || null,
      });

      const orderStatus = await db.syncPurchaseOrderReceiptStatus(
        itemDetail.item.purchaseOrderId
      );

      return {
        success: true,
        orderStatus,
      };
    }),

  movePendingToPurchaseRequest: protectedProcedure
    .input(
      z.object({
        purchaseOrderItemId: z.number(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "No tiene permisos para reenviar saldos pendientes a solicitud de compra",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }

      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderMutable(itemDetail.purchaseOrder.status);

      if (
        !RECEIVABLE_PURCHASE_ORDER_STATUSES.has(itemDetail.purchaseOrder.status)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden reenviar saldos de órdenes con recepciones pendientes",
        });
      }

      if (itemDetail.item.receiptClosed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La línea ya fue cerrada en recepción",
        });
      }

      const orderedQuantity = Number(itemDetail.item.quantity ?? 0);
      const receivedQuantity = Number(itemDetail.item.receivedQuantity ?? 0);

      if (!(receivedQuantity > 0 && receivedQuantity < orderedQuantity)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Solo se pueden reenviar líneas que estén parcialmente recibidas",
        });
      }

      const pendingQuantity = (orderedQuantity - receivedQuantity).toFixed(2);
      const reusablePurchaseRequest =
        await db.getReusablePurchaseRequestBySourcePurchaseOrderId(
          itemDetail.purchaseOrder.id
        );

      const lineNote =
        input.note?.trim() ||
        `Saldo pendiente generado desde ${itemDetail.purchaseOrder.orderNumber}`;

      let purchaseRequestId = reusablePurchaseRequest?.id ?? null;
      let purchaseRequestNumber =
        reusablePurchaseRequest?.requestNumber ?? null;
      const reused = Boolean(reusablePurchaseRequest);

      if (reusablePurchaseRequest) {
        await db.addPurchaseRequestItems(reusablePurchaseRequest.id, [
          {
            materialRequestItemId:
              itemDetail.item.materialRequestItemId ?? null,
            sourcePurchaseOrderItemId: itemDetail.item.id,
            originalSapItemCode: itemDetail.item.originalSapItemCode,
            currentSapItemCode: itemDetail.item.currentSapItemCode,
            itemName: itemDetail.item.itemName,
            quantity: pendingQuantity,
            receivedQuantity: "0.00",
            unit: itemDetail.item.unit,
            unitPrice: itemDetail.item.unitPrice ?? "0.00",
            notes: lineNote,
          },
        ]);
      } else {
        const createdPurchaseRequest = await db.createPurchaseRequest(
          {
            materialRequestId: null,
            sourcePurchaseOrderId: itemDetail.purchaseOrder.id,
            projectId: itemDetail.purchaseOrder.projectId,
            createdById: ctx.user.id,
            purchaseType: itemDetail.purchaseOrder.purchaseType ?? "local",
            status: "pendiente",
            neededBy: itemDetail.purchaseOrder.neededBy,
            sapDocumentNumber: null,
            notes:
              input.note?.trim() ||
              `Saldo pendiente generado desde ${itemDetail.purchaseOrder.orderNumber}`,
            rejectionReason: null,
            printedDocumentName: null,
            printedDocumentMimeType: null,
            printedDocumentContent: null,
            printedAt: null,
            quoteAttachmentId: null,
          },
          [
            {
              materialRequestItemId:
                itemDetail.item.materialRequestItemId ?? null,
              sourcePurchaseOrderItemId: itemDetail.item.id,
              originalSapItemCode: itemDetail.item.originalSapItemCode,
              currentSapItemCode: itemDetail.item.currentSapItemCode,
              itemName: itemDetail.item.itemName,
              quantity: pendingQuantity,
              receivedQuantity: "0.00",
              unit: itemDetail.item.unit,
              unitPrice: itemDetail.item.unitPrice ?? "0.00",
              notes: lineNote,
            },
          ]
        );
        purchaseRequestId = createdPurchaseRequest.id;
        purchaseRequestNumber = createdPurchaseRequest.requestNumber;
      }

      await db.updatePurchaseOrderItem(input.purchaseOrderItemId, {
        receiptClosed: true,
        receiptClosedAt: new Date(),
        receiptClosedById: ctx.user.id,
        receiptCloseNote: lineNote,
      });

      const orderStatus = await db.syncPurchaseOrderReceiptStatus(
        itemDetail.item.purchaseOrderId
      );

      return {
        success: true,
        orderStatus,
        reused,
        purchaseRequestId,
        purchaseRequestNumber,
      };
    }),

  deleteItem: protectedProcedure
    .input(z.object({ purchaseOrderItemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para eliminar lineas de la OC",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const itemDetail = await db.getPurchaseOrderItemById(
        input.purchaseOrderItemId
      );
      if (!itemDetail?.purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item de OC no encontrado",
        });
      }
      assertProjectScopedAccess(ctx.user, itemDetail.purchaseOrder.projectId);
      assertPurchaseOrderStructureEditable(itemDetail.purchaseOrder.status);

      if (Number(itemDetail.item.receivedQuantity ?? 0) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede eliminar una linea que ya tiene recepciones registradas",
        });
      }

      const itemCount = await db.countPurchaseOrderItems(
        itemDetail.item.purchaseOrderId
      );
      await db.deletePurchaseOrderItem(input.purchaseOrderItemId);

      if (itemDetail.item.purchaseRequestItemId) {
        const purchaseRequestItem =
          await db.adjustPurchaseRequestItemConvertedQuantity(
            itemDetail.item.purchaseRequestItemId,
            -Number(itemDetail.item.quantity ?? 0)
          );
        await db.syncPurchaseRequestConversionStatus(
          purchaseRequestItem.purchaseRequestId
        );
      }

      const lineSapCode =
        itemDetail.item.currentSapItemCode ??
        itemDetail.item.originalSapItemCode ??
        null;

      if (itemDetail.purchaseOrder.classification === "cd" && lineSapCode) {
        await releaseDirectPurchaseOrderItems({
          purchaseOrderNumber: itemDetail.purchaseOrder.orderNumber,
          userId: ctx.user.id,
          note: "Flujo cancelado por eliminar la linea de la orden de compra",
          sapItemCode: lineSapCode,
        });
      } else {
        await releaseDirectPurchaseRequestItems(
          [itemDetail.item.materialRequestItemId],
          ctx.user.id,
          "Flujo cancelado por eliminar la linea de la orden de compra"
        );
      }

      if (itemCount <= 1) {
        await db.updatePurchaseOrder(itemDetail.item.purchaseOrderId, {
          status: "anulada",
          emailStatus: "pendiente",
          emailedAt: null,
          emailError: "Orden anulada por eliminar su ultima linea",
        });
      }

      return { success: true, orderCancelled: itemCount <= 1 };
    }),

  cancelOrder: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para cancelar la OC",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(detail.purchaseOrder.status);

      const receivedItem = (detail.items ?? []).find(
        (item: any) => Number(item.receivedQuantity ?? 0) > 0
      );
      if (receivedItem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede cancelar una orden que ya tiene recepciones registradas",
        });
      }

      if (detail.purchaseOrder.classification === "cd") {
        await releaseDirectPurchaseOrderItems({
          purchaseOrderNumber: detail.purchaseOrder.orderNumber,
          userId: ctx.user.id,
          note: `Flujo cancelado por anular la orden ${detail.purchaseOrder.orderNumber}`,
        });
      } else {
        await releaseDirectPurchaseRequestItems(
          (detail.items ?? []).map((item: any) => item.materialRequestItemId),
          ctx.user.id,
          `Flujo cancelado por anular la orden ${detail.purchaseOrder.orderNumber}`
        );
      }

      const affectedPurchaseRequestIds = new Set<number>();
      for (const item of detail.items ?? []) {
        if (!item.purchaseRequestItemId) continue;
        const purchaseRequestItem =
          await db.adjustPurchaseRequestItemConvertedQuantity(
            item.purchaseRequestItemId,
            -Number(item.quantity ?? 0)
          );
        affectedPurchaseRequestIds.add(purchaseRequestItem.purchaseRequestId);
      }

      await db.updatePurchaseOrder(input.id, {
        status: "anulada",
        emailStatus: "pendiente",
        emailedAt: null,
        emailError: "Orden anulada manualmente",
      });

      for (const purchaseRequestId of Array.from(affectedPurchaseRequestIds)) {
        await db.syncPurchaseRequestConversionStatus(purchaseRequestId);
      }

      return { success: true };
    }),

  reopenDraft: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.user.role !== "admin" &&
        ctx.user.buildreqRole !== "administracion_central"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo Administración Central puede reabrir una OC",
        });
      }

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);

      if (!["emitida", "enviada"].includes(detail.purchaseOrder.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se puede reabrir una OC emitida sin recepciones",
        });
      }

      const hasReceipts = (detail.items ?? []).some(
        (item: any) =>
          Number(item.receivedQuantity ?? 0) > 0 || item.receiptClosed
      );
      if (hasReceipts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede reabrir una OC que ya tiene recepciones registradas",
        });
      }

      await db.updatePurchaseOrder(input.id, {
        status: "borrador",
        emailStatus: "pendiente",
        emailedAt: null,
        emailError: null,
      });

      return { success: true };
    }),

  sendToSupplier: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAccessPurchaseOrders(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para emitir la OC",
        });
      }
      assertCanModifyPurchaseOrders(ctx.user);

      const detail = await db.getPurchaseOrderById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      assertPurchaseOrderEditable(detail.purchaseOrder.status);

      if (
        detail.purchaseOrder.status === "anulada" ||
        (detail.items?.length ?? 0) === 0
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede emitir una orden anulada o sin lineas",
        });
      }

      const hasReceipts =
        detail.purchaseOrder.status === "recibida" ||
        detail.purchaseOrder.status === "parcialmente_recibida" ||
        (detail.items ?? []).some(
          (item: any) => Number(item.receivedQuantity ?? 0) > 0
        );

      if (hasReceipts) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No se puede emitir una orden que ya tiene recepciones registradas",
        });
      }

      if (
        detail.purchaseOrder.status &&
        detail.purchaseOrder.status !== "borrador"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La orden de compra ya fue emitida",
        });
      }

      if (!detail.purchaseOrder.supplierId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione un proveedor antes de emitir la OC",
        });
      }

      const itemWithoutPrice = (detail.items ?? []).find(
        (item: any) =>
          !Number.isFinite(Number(item.unitPrice ?? 0)) ||
          Number(item.unitPrice ?? 0) <= 0
      );
      if (itemWithoutPrice) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Ingrese un precio unitario mayor que cero antes de emitir la OC",
        });
      }

      await db.updatePurchaseOrder(input.id, {
        status: "emitida",
        emailStatus: "pendiente",
        emailedAt: null,
        emailError: null,
      });

      return { success: true };
    }),
});
