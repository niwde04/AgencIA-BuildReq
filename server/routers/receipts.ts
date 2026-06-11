import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import {
  CAI_FORMAT_EXAMPLE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  formatInvoiceNumberInput,
  isValidCai,
  isFiscalInvoiceRangeOrdered,
  isInvoiceNumberWithinFiscalRange,
  isValidInvoiceNumber,
} from "@shared/invoices";
import {
  ASSET_CONDITION_VALUES,
  normalizeFixedAssetDetails,
} from "@shared/fixed-assets";
import { applyProjectScope, canAccessProject } from "../projectAccess";

const RECEIVABLE_PURCHASE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
]);
const RECEIVABLE_TRANSFER_STATUSES = new Set([
  "confirmado",
  "en_transito",
  "parcialmente_recibido",
]);

function canAccessReceipts(user: {
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

function canReceivePurchaseOrder(purchaseOrder: any, contractSummary?: any) {
  if (RECEIVABLE_PURCHASE_ORDER_STATUSES.has(purchaseOrder.status)) {
    return true;
  }

  if (!purchaseOrder.appliesContract) return false;
  if (purchaseOrder.status === "anulada") return false;

  return Boolean(
    contractSummary &&
      contractSummary.expectedInvoiceCount > 0 &&
      !contractSummary.isExpired &&
      !contractSummary.isFullyInvoiced
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
    user.buildreqRole !== "administrador_proyecto" &&
    user.buildreqRole !== "bodeguero_proyecto"
  ) {
    return;
  }
  if (!canAccessProject(user, projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a recepciones de otro proyecto",
    });
  }
}

const fixedAssetDetailSchema = z.object({
  serialNumber: z.string().trim().max(120),
  condition: z.enum(ASSET_CONDITION_VALUES),
  color: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(120).nullish(),
  chassisSeries: z.string().trim().max(120).nullish(),
  motorSeries: z.string().trim().max(120).nullish(),
  plateOrCode: z.string().trim().max(120).nullish(),
});

type ReceiptLineTargetFields = {
  targetType: "subproyecto" | "activo_fijo" | null;
  subProjectId: number | null;
  fixedAssetSapItemCode: string | null;
  fixedAssetName: string | null;
};

type ReceiptLineTargetInput = {
  itemName: string;
  targetType?: "subproyecto" | "activo_fijo" | null;
  subProjectId?: number | null;
  fixedAssetSapItemCode?: string | null;
  fixedAssetName?: string | null;
};

const emptyReceiptLineTarget = (): ReceiptLineTargetFields => ({
  targetType: null,
  subProjectId: null,
  fixedAssetSapItemCode: null,
  fixedAssetName: null,
});

function extractReceiptLineTarget(value: any): ReceiptLineTargetFields {
  if (value?.target?.type === "subproyecto" && value.target.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: Number(value.target.subProjectId),
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  if (
    value?.target?.type === "activo_fijo" &&
    value.target.fixedAssetSapItemCode
  ) {
    return {
      targetType: "activo_fijo",
      subProjectId: null,
      fixedAssetSapItemCode: String(value.target.fixedAssetSapItemCode).trim(),
      fixedAssetName: value.target.fixedAssetName?.trim() || null,
    };
  }

  if (value?.targetType === "subproyecto" && value.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: Number(value.subProjectId),
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  if (value?.targetType === "activo_fijo" && value.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      subProjectId: null,
      fixedAssetSapItemCode: String(value.fixedAssetSapItemCode).trim(),
      fixedAssetName: value.fixedAssetName?.trim() || null,
    };
  }

  return emptyReceiptLineTarget();
}

function isSameReceiptLineTarget(
  left: ReceiptLineTargetFields,
  right: ReceiptLineTargetFields
) {
  if (left.targetType !== right.targetType) return false;
  if (!left.targetType) return true;
  if (left.targetType === "subproyecto") {
    return left.subProjectId === right.subProjectId;
  }
  return left.fixedAssetSapItemCode === right.fixedAssetSapItemCode;
}

async function resolveReceiptLineTarget(params: {
  item: ReceiptLineTargetInput;
  sourceItem?: any;
  projectId: number;
}): Promise<ReceiptLineTargetFields> {
  const sourceTarget = extractReceiptLineTarget(params.sourceItem);
  const hasExplicitTarget =
    params.item.targetType !== undefined ||
    params.item.subProjectId !== undefined ||
    params.item.fixedAssetSapItemCode !== undefined;
  const requestedTarget = hasExplicitTarget
    ? extractReceiptLineTarget(params.item)
    : sourceTarget;

  if (!requestedTarget.targetType) {
    return emptyReceiptLineTarget();
  }

  if (isSameReceiptLineTarget(requestedTarget, sourceTarget)) {
    return {
      ...requestedTarget,
      fixedAssetName:
        requestedTarget.fixedAssetName ?? sourceTarget.fixedAssetName,
    };
  }

  if (requestedTarget.targetType === "subproyecto") {
    if (!requestedTarget.subProjectId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Seleccione un subproyecto válido para ${params.item.itemName}`,
      });
    }

    const subproject = await db.getProjectSubprojectById(
      requestedTarget.subProjectId
    );
    if (
      !subproject ||
      subproject.projectId !== params.projectId ||
      subproject.isActive === false
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El subproyecto de ${params.item.itemName} no pertenece al proyecto o está inactivo`,
      });
    }

    return {
      targetType: "subproyecto",
      subProjectId: subproject.id,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  const fixedAssetSapItemCode = requestedTarget.fixedAssetSapItemCode?.trim();
  if (!fixedAssetSapItemCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seleccione un activo fijo válido para ${params.item.itemName}`,
    });
  }

  const fixedAsset = await db.getActiveFixedAssetByCode(
    fixedAssetSapItemCode,
    params.projectId
  );
  if (!fixedAsset) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El activo fijo de ${params.item.itemName} no existe, está inactivo o no pertenece al proyecto`,
    });
  }

  return {
    targetType: "activo_fijo",
    subProjectId: null,
    fixedAssetSapItemCode: fixedAsset.itemCode,
    fixedAssetName: fixedAsset.description,
  };
}

const receiptItemSchema = z
  .object({
    sourceItemId: z.number().nullable().optional(),
    sapItemCode: z.string().trim().max(50).nullable().optional(),
    warehouseId: z.number().int().positive().optional(),
    itemName: z.string().min(1),
    quantityExpected: z.string().min(1),
    quantityReceived: z.string().min(1),
    unit: z.string().optional(),
    unitPrice: z.string().trim().optional(),
    taxCode: z.string().trim().min(1).optional(),
    additionalTaxCodes: z.array(z.string().trim().min(1)).optional(),
    targetType: z.enum(["subproyecto", "activo_fijo"]).nullable().optional(),
    subProjectId: z.number().int().positive().nullable().optional(),
    fixedAssetSapItemCode: z.string().trim().max(50).nullable().optional(),
    fixedAssetName: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    isFixedAsset: z.boolean().optional(),
    isLeasing: z.boolean().optional(),
    assetDetails: z.array(fixedAssetDetailSchema).optional(),
    closeRemaining: z.boolean().optional(),
    closeReason: z.string().trim().max(120).optional(),
    closeNote: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.isFixedAsset !== true) return;

    const quantityReceived = Number(value.quantityReceived);
    if (quantityReceived !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantityReceived"],
        message:
          "Activo fijo requiere que la cantidad recibida sea exactamente 1",
      });
      return;
    }

    if (value.targetType !== "activo_fijo") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetType"],
        message:
          "Solo se puede activar Activo fijo para productos clasificados como Activo Fijo",
      });
    }

    const assetDetails = value.assetDetails ?? [];
    if (assetDetails.length !== quantityReceived) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetDetails"],
        message: `Registre ${quantityReceived} detalle(s) de activo fijo para esta línea`,
      });
    }

    assetDetails.forEach((detail, index) => {
      if (!detail.serialNumber.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assetDetails", index, "serialNumber"],
          message: "Ingrese el número de serie del activo",
        });
      }
    });
  });

const receiptOtherChargeSchema = z.object({
  concept: z.string().trim().min(1).max(255),
  amount: z
    .string()
    .trim()
    .min(1)
    .refine(value => Number.isFinite(Number(value)) && Number(value) > 0, {
      message: "El monto debe ser mayor que cero",
    }),
});

function parseDateInput(value: string) {
  return new Date(`${value}T12:00:00`);
}

function getTransferPendingQuantity(item: any) {
  if (item.receiptClosed) return 0;
  return Math.max(
    Number(item.quantity ?? 0) -
      Number(item.receivedQuantity ?? 0) -
      Number(item.returnedToOriginQuantity ?? 0),
    0
  );
}

function canCloseTransferReceiptLine(
  user: {
    role: string;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  detail: any
) {
  if (user.buildreqRole === "administracion_central") return true;

  const destinationProjectId =
    detail.transferRequest?.destinationType === "proyecto"
      ? detail.transferRequest.destinationProjectId
      : null;

  return (
    user.buildreqRole === "administrador_proyecto" &&
    destinationProjectId !== null &&
    canAccessProject(user, destinationProjectId)
  );
}

function isPurchaseOrderServiceLine(params: {
  sourceItem?: any;
  catalogItem?: { tipoArticulo?: number | null } | null;
}) {
  return (
    Number(
      params.sourceItem?.catalogItem?.tipoArticulo ??
        params.sourceItem?.tipoArticulo ??
        params.catalogItem?.tipoArticulo ??
        0
    ) === 2
  );
}

async function assertReceiptWarehouses(
  projectId: number,
  items: Array<{
    warehouseId?: number;
    quantityReceived: string;
    itemName: string;
  }>,
  options?: { allowAnyActiveWarehouse?: boolean }
) {
  const activeWarehouses = options?.allowAnyActiveWarehouse
    ? await db.listWarehouses({ isActive: true })
    : await db.listProjectWarehouses(projectId, {
        isActive: true,
      });
  const activeWarehouseIds = new Set(
    activeWarehouses.map(warehouse => warehouse.id)
  );

  for (const item of items) {
    if (Number(item.quantityReceived ?? 0) <= 0) continue;
    if (!item.warehouseId || !activeWarehouseIds.has(item.warehouseId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: options?.allowAnyActiveWarehouse
          ? `Seleccione un almacén activo para ${item.itemName}`
          : `Seleccione un almacén activo del proyecto para ${item.itemName}`,
      });
    }
  }
}

function preparePurchaseOrderReceiptItemFinancialData(params: {
  item: z.infer<typeof receiptItemSchema>;
  sourceItem: any;
  taxes: Awaited<ReturnType<typeof db.getActiveSalesTaxCatalog>>;
}) {
  try {
    return db.prepareReceiptItemFinancialDataForLine({
      quantity: params.item.quantityReceived,
      unitPrice:
        params.item.unitPrice ?? params.sourceItem?.unitPrice ?? "0.00",
      taxCode: params.item.taxCode ?? params.sourceItem?.taxCode ?? "exe",
      additionalTaxCodes:
        params.item.additionalTaxCodes ??
        params.sourceItem?.additionalTaxCodes ??
        [],
      taxes: params.taxes,
    });
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Seleccione un impuesto válido",
    });
  }
}

function normalizeReceiptOtherCharges(
  otherCharges: Array<z.infer<typeof receiptOtherChargeSchema>> | undefined
) {
  return (otherCharges ?? []).map(charge => ({
    concept: charge.concept.trim(),
    amount: charge.amount.trim(),
  }));
}

export const receiptsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          sourceType: z.enum(["purchase_order", "transfer"]).optional(),
          status: z
            .enum([
              "borrador",
              "pendiente",
              "parcial",
              "completa",
              "cierre_incompleto",
              "anulada",
            ])
            .optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!canAccessReceipts(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a recepciones",
        });
      }

      return db.listReceipts(applyProjectScope(input ?? {}, ctx.user));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!canAccessReceipts(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a recepciones",
        });
      }

      const detail = await db.getReceiptById(input.id);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recepción no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.receipt.projectId);
      return detail;
    }),

  lookupFiscalDocumentRange: protectedProcedure
    .input(
      z.object({
        purchaseOrderId: z.number(),
        invoiceNumber: z.string().trim().max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessReceipts(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene acceso a recepciones",
        });
      }

      const detail = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);

      if (!isValidInvoiceNumber(input.invoiceNumber)) return null;

      const range = await db.lookupSupplierFiscalDocumentRangeBySupplier({
        supplierRtn: detail.supplier?.rtn,
        invoiceNumber: formatInvoiceNumberInput(input.invoiceNumber),
      });
      if (!range) return null;

      return {
        cai: range.cai,
        documentRangeStart: range.documentRangeStart,
        documentRangeEnd: range.documentRangeEnd,
        emissionDeadline: range.emissionDeadline,
      };
    }),

  saveDraft: protectedProcedure
    .input(
      z.object({
        sourceType: z.literal("purchase_order"),
        sourceId: z.number(),
        projectId: z.number(),
        isFiscalDocument: z.boolean().optional(),
        cai: z.string().trim().max(100).optional(),
        invoiceNumber: z.string().trim().max(100).optional(),
        documentRangeStart: z.string().trim().max(100).optional(),
        documentRangeEnd: z.string().trim().max(100).optional(),
        documentDate: z.string().optional(),
        documentDueDate: z.string().optional(),
        postingDate: z.string().optional(),
        receiptDate: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(receiptItemSchema).min(1),
        otherCharges: z.array(receiptOtherChargeSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessReceipts(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para guardar borradores de recepción",
        });
      }

      const detail = await db.getPurchaseOrderById(input.sourceId);
      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de compra no encontrada",
        });
      }
      assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
      if (input.projectId !== detail.purchaseOrder.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "El proyecto del borrador no coincide con la orden de compra",
        });
      }

      const itemsById = new Map(
        (detail.items ?? []).map((item: any) => [item.id, item])
      );
      const serviceReceiptLineIndexes = new Set<number>();
      for (let itemIndex = 0; itemIndex < input.items.length; itemIndex += 1) {
        const item = input.items[itemIndex];
        let catalogItem: Awaited<
          ReturnType<typeof db.lookupSapItemByCode>
        > | null = null;
        if (!item.sourceItemId) {
          if (!item.sapItemCode?.trim()) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Seleccione un SKU para cada producto agregado",
            });
          }
          catalogItem = await db.lookupSapItemByCode(item.sapItemCode);
          if (!catalogItem) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `El SKU ${item.sapItemCode} no existe en el catálogo SAP`,
            });
          }
        } else if (!itemsById.has(item.sourceItemId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El borrador incluye un ítem que ya no existe en la orden",
          });
        }

        const sourceItem = item.sourceItemId
          ? itemsById.get(item.sourceItemId)
          : undefined;
        if (isPurchaseOrderServiceLine({ sourceItem, catalogItem })) {
          serviceReceiptLineIndexes.add(itemIndex);
        }
      }

      const isFiscalDocument = input.isFiscalDocument !== false;
      const now = new Date();
      const activeSalesTaxes = await db.getActiveSalesTaxCatalog();
      const draftData = {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        projectId: input.projectId,
        receivedById: ctx.user.id,
        isFiscalDocument,
        cai: input.cai?.trim()
          ? isValidCai(input.cai)
            ? formatCaiInput(input.cai)
            : input.cai.trim()
          : null,
        invoiceNumber: input.invoiceNumber?.trim()
          ? isValidInvoiceNumber(input.invoiceNumber)
            ? formatInvoiceNumberInput(input.invoiceNumber)
            : input.invoiceNumber.trim()
          : null,
        documentRangeStart: input.documentRangeStart?.trim()
          ? isValidInvoiceNumber(input.documentRangeStart)
            ? formatInvoiceNumberInput(input.documentRangeStart)
            : input.documentRangeStart.trim()
          : null,
        documentRangeEnd: input.documentRangeEnd?.trim()
          ? isValidInvoiceNumber(input.documentRangeEnd)
            ? formatInvoiceNumberInput(input.documentRangeEnd)
            : input.documentRangeEnd.trim()
          : null,
        documentDate: input.documentDate
          ? parseDateInput(input.documentDate)
          : null,
        documentDueDate: input.documentDueDate
          ? parseDateInput(input.documentDueDate)
          : null,
        postingDate: input.postingDate
          ? parseDateInput(input.postingDate)
          : now,
        receiptDate: input.receiptDate
          ? parseDateInput(input.receiptDate)
          : now,
        notes: input.notes?.trim() || null,
      };
      const draftItems = await Promise.all(
        input.items.map(async (item, index) => {
          const sourceItem = item.sourceItemId
            ? itemsById.get(item.sourceItemId)
            : undefined;
          const isServiceLine = serviceReceiptLineIndexes.has(index);
          const targetFields = await resolveReceiptLineTarget({
            item,
            sourceItem,
            projectId: input.projectId,
          });
          const financialData = preparePurchaseOrderReceiptItemFinancialData({
            item,
            sourceItem,
            taxes: activeSalesTaxes,
          });
          const isFixedAsset = item.isFixedAsset === true;
          const quantityReceived = Number(item.quantityReceived);
          const assetCount =
            isFixedAsset &&
            Number.isFinite(quantityReceived) &&
            quantityReceived > 0
              ? Math.max(1, Math.trunc(quantityReceived))
              : 0;
          return {
            sourceItemId: item.sourceItemId ?? null,
            sapItemCode:
              sourceItem?.currentSapItemCode ??
              sourceItem?.originalSapItemCode ??
              item.sapItemCode?.trim() ??
              null,
            warehouseId: isServiceLine ? undefined : item.warehouseId,
            itemName: item.itemName,
            quantityExpected: item.quantityExpected,
            quantityReceived: item.quantityReceived,
            unit: item.unit,
            unitPrice: item.unitPrice ?? "0.00",
            ...financialData,
            ...targetFields,
            notes: item.notes?.trim() || null,
            isFixedAsset,
            isLeasing: isFixedAsset ? item.isLeasing === true : false,
            assetDetails: isFixedAsset
              ? normalizeFixedAssetDetails(item.assetDetails, assetCount)
              : [],
          };
        })
      );
      const otherCharges = normalizeReceiptOtherCharges(input.otherCharges);
      return otherCharges.length > 0
        ? db.saveReceiptDraft(draftData, draftItems, otherCharges)
        : db.saveReceiptDraft(draftData, draftItems);
    }),

  register: protectedProcedure
    .input(
      z
        .object({
          sourceType: z.enum(["purchase_order", "transfer"]),
          sourceId: z.number(),
          projectId: z.number(),
          isFiscalDocument: z.boolean().optional(),
          cai: z.string().trim().max(100).optional(),
          invoiceNumber: z.string().trim().max(100).optional(),
          documentRangeStart: z.string().trim().max(100).optional(),
          documentRangeEnd: z.string().trim().max(100).optional(),
          documentDate: z.string().optional(),
          documentDueDate: z.string().optional(),
          postingDate: z.string(),
          receiptDate: z.string().optional(),
          emissionDeadline: z.string().optional(),
          notes: z.string().optional(),
          items: z.array(receiptItemSchema).min(1),
          otherCharges: z.array(receiptOtherChargeSchema).optional(),
        })
        .superRefine((value, ctx) => {
          const requiresFiscalFormat =
            value.sourceType === "purchase_order" &&
            value.isFiscalDocument !== false;
          if (requiresFiscalFormat) {
            if (!value.cai?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["cai"],
                message: "Ingrese el CAI del documento",
              });
            } else if (!isValidCai(value.cai)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["cai"],
                message: `El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`,
              });
            }
            if (!value.invoiceNumber?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["invoiceNumber"],
                message: "Ingrese el número documento",
              });
            } else if (!isValidInvoiceNumber(value.invoiceNumber)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["invoiceNumber"],
                message: `El número documento debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
              });
            }
            if (!value.documentRangeStart?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeStart"],
                message: "Ingrese el rango autorizado inicial",
              });
            } else if (!isValidInvoiceNumber(value.documentRangeStart)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeStart"],
                message: `El rango autorizado inicial debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
              });
            }
            if (!value.documentRangeEnd?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeEnd"],
                message: "Ingrese el rango autorizado final",
              });
            } else if (!isValidInvoiceNumber(value.documentRangeEnd)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeEnd"],
                message: `El rango autorizado final debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`,
              });
            }
            if (
              value.documentRangeStart?.trim() &&
              value.documentRangeEnd?.trim() &&
              isValidInvoiceNumber(value.documentRangeStart) &&
              isValidInvoiceNumber(value.documentRangeEnd) &&
              !isFiscalInvoiceRangeOrdered({
                documentRangeStart: value.documentRangeStart,
                documentRangeEnd: value.documentRangeEnd,
              })
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentRangeEnd"],
                message:
                  "El rango autorizado final debe ser mayor o igual al inicial",
              });
            }
            if (
              value.invoiceNumber?.trim() &&
              value.documentRangeStart?.trim() &&
              value.documentRangeEnd?.trim() &&
              isValidInvoiceNumber(value.invoiceNumber) &&
              isValidInvoiceNumber(value.documentRangeStart) &&
              isValidInvoiceNumber(value.documentRangeEnd) &&
              isFiscalInvoiceRangeOrdered({
                documentRangeStart: value.documentRangeStart,
                documentRangeEnd: value.documentRangeEnd,
              }) &&
              !isInvoiceNumberWithinFiscalRange({
                invoiceNumber: value.invoiceNumber,
                documentRangeStart: value.documentRangeStart,
                documentRangeEnd: value.documentRangeEnd,
              })
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["invoiceNumber"],
                message:
                  "El número documento debe estar dentro del rango autorizado",
              });
            }
            if (!value.documentDate) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentDate"],
                message: "Seleccione la fecha del documento",
              });
            }
            if (!value.documentDueDate) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentDueDate"],
                message: "Seleccione la fecha de vencimiento del documento",
              });
            }
            if (!value.emissionDeadline) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["emissionDeadline"],
                message: "Seleccione la fecha límite de emisión",
              });
            }
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAccessReceipts(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para registrar recepciones",
        });
      }
      let purchaseOrderItemsByIdForPayload = new Map<number, any>();
      let allowAnyActiveReceiptWarehouse = false;
      const serviceReceiptLineIndexes = new Set<number>();

      if (input.sourceType === "purchase_order") {
        const detail = await db.getPurchaseOrderById(input.sourceId);
        if (!detail) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden de compra no encontrada",
          });
        }
        assertProjectScopedAccess(ctx.user, detail.purchaseOrder.projectId);
        if (input.projectId !== detail.purchaseOrder.projectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "El proyecto de la recepción no coincide con la orden de compra",
          });
        }

        if (
          !canReceivePurchaseOrder(detail.purchaseOrder, detail.contractSummary)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Solo se pueden recibir órdenes emitidas con saldo pendiente o contratos vigentes",
          });
        }

        if (detail.purchaseOrder.appliesContract) {
          const contractSummary = detail.contractSummary;
          if (
            !detail.purchaseOrder.contractPaymentFrequency ||
            !detail.purchaseOrder.contractFirstPaymentDate ||
            !detail.purchaseOrder.contractEndDate ||
            contractSummary.expectedInvoiceCount <= 0
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La OC de contrato no tiene una programación de pagos válida",
            });
          }
          if (contractSummary.isExpired) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "El contrato está vencido y ya no permite agregar facturas",
            });
          }
          if (contractSummary.isFullyInvoiced) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La OC de contrato ya alcanzó el total de facturas programadas",
            });
          }
        }

        const itemsById = new Map(
          (detail.items ?? []).map((item: any) => [item.id, item])
        );
        purchaseOrderItemsByIdForPayload = itemsById;
        const unresolvedFixedAsset = (detail.items ?? []).find(
          (item: any) =>
            item.isFixedAsset === true && item.fixedAssetStatus !== "resuelto"
        );
        if (unresolvedFixedAsset) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La línea ${unresolvedFixedAsset.itemName} tiene un activo fijo pendiente de código real`,
          });
        }
        let hasPositiveReceipt = false;

        for (
          let itemIndex = 0;
          itemIndex < input.items.length;
          itemIndex += 1
        ) {
          const item = input.items[itemIndex];
          const sourceItem = item.sourceItemId
            ? itemsById.get(item.sourceItemId)
            : undefined;
          let catalogItem: Awaited<
            ReturnType<typeof db.lookupSapItemByCode>
          > | null = null;
          if (!sourceItem) {
            if (!item.sapItemCode?.trim()) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Seleccione un SKU para cada producto agregado",
              });
            }
            catalogItem = await db.lookupSapItemByCode(item.sapItemCode);
            if (!catalogItem) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `El SKU ${item.sapItemCode} no existe en el catálogo SAP`,
              });
            }
          }

          if (sourceItem?.receiptClosed) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La línea ${sourceItem.itemName} fue cerrada y ya no admite recepciones`,
            });
          }

          const requestedQuantity = Number(item.quantityReceived ?? 0);
          const isServiceLine = isPurchaseOrderServiceLine({
            sourceItem,
            catalogItem,
          });
          if (isServiceLine) {
            serviceReceiptLineIndexes.add(itemIndex);
          }
          if (requestedQuantity > 0 && !isServiceLine && !item.warehouseId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Seleccione almacén destino para ${
                sourceItem?.itemName ?? item.itemName
              }`,
            });
          }
          if (item.isFixedAsset === true && sourceItem?.isFixedAsset !== true) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Guarde como borrador el activo fijo de ${
                sourceItem?.itemName ?? item.itemName
              } antes de registrar la recepción`,
            });
          }

          if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La cantidad a recibir de ${
                sourceItem?.itemName ?? item.itemName
              } debe ser cero o mayor`,
            });
          }

          if (requestedQuantity > 0) {
            hasPositiveReceipt = true;
          }

          if (!sourceItem && requestedQuantity <= 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Ingrese una cantidad mayor que cero para ${item.itemName}`,
            });
          }

          if (sourceItem?.isFixedAsset === true) {
            if (requestedQuantity !== 1) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La recepción del activo fijo ${sourceItem.itemName} debe ser exactamente 1`,
              });
            }
            const sourceAssetDetails = normalizeFixedAssetDetails(
              sourceItem.assetDetails,
              1
            );
            if (
              sourceAssetDetails.length !== 1 ||
              !sourceAssetDetails[0]?.serialNumber.trim()
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La línea ${sourceItem.itemName} no tiene datos completos de activo fijo`,
              });
            }
          }

          const unitPrice = Number(item.unitPrice ?? 0);
          if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `El precio confirmado de ${
                sourceItem?.itemName ?? item.itemName
              } debe ser cero o mayor`,
            });
          }
        }

        if (!hasPositiveReceipt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Ingrese al menos una cantidad mayor que cero para registrar la recepción",
          });
        }
      } else {
        const detail = await db.getTransferById(input.sourceId);
        if (!detail) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Traslado no encontrado",
          });
        }

        const destinationProjectId =
          detail.transferRequest?.destinationType === "proyecto"
            ? detail.transferRequest.destinationProjectId
            : input.projectId;
        allowAnyActiveReceiptWarehouse =
          detail.transferRequest?.destinationType === "bodega_central";
        if (typeof destinationProjectId === "number") {
          assertProjectScopedAccess(ctx.user, destinationProjectId);
          if (
            detail.transferRequest?.destinationType === "proyecto" &&
            input.projectId !== destinationProjectId
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "El proyecto de la recepción no coincide con el destino del traslado",
            });
          }
        }

        if (!RECEIVABLE_TRANSFER_STATUSES.has(detail.transfer.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Solo se pueden recibir traslados confirmados o con saldo pendiente",
          });
        }

        const itemsById = new Map(
          (detail.items ?? []).map((item: any) => [item.id, item])
        );
        const lockedReverseLogisticDestinationWarehouseId =
          detail.transferRequest?.reverseLogisticId &&
          detail.transferRequest.destinationType === "proyecto" &&
          detail.destinationWarehouse?.id
            ? Number(detail.destinationWarehouse.id)
            : null;
        let hasPositiveReceipt = false;
        let hasTransferClosure = false;

        for (const item of input.items) {
          const sourceItem = item.sourceItemId
            ? itemsById.get(item.sourceItemId)
            : undefined;
          if (!sourceItem) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La recepción incluye un ítem que ya no existe en el traslado",
            });
          }

          const pendingQuantity = getTransferPendingQuantity(sourceItem);
          const requestedQuantity = Number(item.quantityReceived ?? 0);
          const closeQuantity = item.closeRemaining
            ? Math.max(pendingQuantity - requestedQuantity, 0)
            : 0;
          if (requestedQuantity > 0 && !item.warehouseId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Seleccione almacén destino para ${sourceItem.itemName}`,
            });
          }
          if (
            requestedQuantity > 0 &&
            sourceItem.sourceWarehouseId &&
            item.warehouseId === Number(sourceItem.sourceWarehouseId)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${sourceItem.itemName}: no se puede ingresar a la misma bodega de origen`,
            });
          }
          if (
            requestedQuantity > 0 &&
            lockedReverseLogisticDestinationWarehouseId &&
            item.warehouseId !== lockedReverseLogisticDestinationWarehouseId
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${sourceItem.itemName}: debe ingresar a la bodega destino de la devolución`,
            });
          }

          if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La cantidad a recibir de ${sourceItem.itemName} debe ser cero o mayor`,
            });
          }

          if (item.closeRemaining) {
            if (closeQuantity <= 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La línea ${sourceItem.itemName} no tiene saldo pendiente para cerrar`,
              });
            }

            if (!canCloseTransferReceiptLine(ctx.user, detail)) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message:
                  "Solo Administración Central o el Administrador del Proyecto destino pueden cerrar saldos de traslado",
              });
            }

            if (!item.closeReason?.trim()) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Seleccione el motivo del cierre incompleto",
              });
            }

            if (!item.closeNote?.trim()) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Ingrese una nota para cerrar el saldo del traslado",
              });
            }

            hasTransferClosure = true;
          }

          if (requestedQuantity > 0) {
            hasPositiveReceipt = true;
          }
        }

        if (!hasPositiveReceipt && !hasTransferClosure) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Ingrese al menos una cantidad mayor que cero o cierre un saldo pendiente para registrar la recepción",
          });
        }
      }

      const isFiscalDocument =
        input.sourceType === "purchase_order" &&
        input.isFiscalDocument !== false;

      const warehouseRequiredItems =
        input.sourceType === "purchase_order"
          ? input.items.filter(
              (_item, index) => !serviceReceiptLineIndexes.has(index)
            )
          : input.items;
      await assertReceiptWarehouses(input.projectId, warehouseRequiredItems, {
        allowAnyActiveWarehouse: allowAnyActiveReceiptWarehouse,
      });

      const activeSalesTaxes =
        input.sourceType === "purchase_order"
          ? await db.getActiveSalesTaxCatalog()
          : [];
      const otherCharges = normalizeReceiptOtherCharges(input.otherCharges);
      if (input.sourceType !== "purchase_order" && otherCharges.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Los otros cargos solo aplican a recepciones de orden de compra",
        });
      }

      const receiptData = {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        projectId: input.projectId,
        receivedById: ctx.user.id,
        status: "pendiente" as const,
        isFiscalDocument,
        cai: input.cai?.trim()
          ? isFiscalDocument
            ? formatCaiInput(input.cai)
            : input.cai.trim()
          : null,
        invoiceNumber: input.invoiceNumber
          ? isFiscalDocument
            ? formatInvoiceNumberInput(input.invoiceNumber)
            : input.invoiceNumber.trim()
          : null,
        documentRangeStart: input.documentRangeStart
          ? isFiscalDocument
            ? formatInvoiceNumberInput(input.documentRangeStart)
            : input.documentRangeStart.trim()
          : null,
        documentRangeEnd: input.documentRangeEnd
          ? isFiscalDocument
            ? formatInvoiceNumberInput(input.documentRangeEnd)
            : input.documentRangeEnd.trim()
          : null,
        documentDate: input.documentDate
          ? parseDateInput(input.documentDate)
          : null,
        documentDueDate: input.documentDueDate
          ? parseDateInput(input.documentDueDate)
          : null,
        postingDate: parseDateInput(input.postingDate),
        receiptDate: parseDateInput(input.receiptDate || input.postingDate),
        emissionDeadline: input.emissionDeadline
          ? parseDateInput(input.emissionDeadline)
          : null,
        notes: input.notes,
      };
      const receiptItems = await Promise.all(
        input.items.map(async (item, index) => {
          const sourceItem = item.sourceItemId
            ? purchaseOrderItemsByIdForPayload.get(item.sourceItemId)
            : undefined;
          const isServiceLine =
            input.sourceType === "purchase_order" &&
            serviceReceiptLineIndexes.has(index);
          const targetFields =
            input.sourceType === "purchase_order"
              ? await resolveReceiptLineTarget({
                  item,
                  sourceItem,
                  projectId: input.projectId,
                })
              : emptyReceiptLineTarget();
          const financialData =
            input.sourceType === "purchase_order"
              ? preparePurchaseOrderReceiptItemFinancialData({
                  item,
                  sourceItem,
                  taxes: activeSalesTaxes,
                })
              : {};
          const isFixedAsset = item.isFixedAsset === true;
          const quantityReceived = Number(item.quantityReceived);
          const sourceIsFixedAsset = sourceItem?.isFixedAsset === true;
          const fixedAssetDetails = sourceIsFixedAsset
            ? normalizeFixedAssetDetails(sourceItem.assetDetails, 1)
            : normalizeFixedAssetDetails(item.assetDetails, quantityReceived);
          const closeNote =
            input.sourceType === "transfer" && item.closeRemaining
              ? [
                  "Cierre incompleto con devolución al origen y regreso a requisición.",
                  item.closeReason ? `Motivo: ${item.closeReason}.` : null,
                  item.closeNote ? `Nota: ${item.closeNote}` : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : undefined;

          return {
            sourceItemId: item.sourceItemId ?? null,
            sapItemCode:
              sourceItem?.currentSapItemCode ??
              sourceItem?.originalSapItemCode ??
              item.sapItemCode?.trim() ??
              null,
            warehouseId: isServiceLine ? undefined : item.warehouseId,
            itemName: item.itemName,
            quantityExpected: item.quantityExpected,
            quantityReceived: item.quantityReceived,
            unit: item.unit,
            unitPrice:
              input.sourceType === "purchase_order"
                ? (item.unitPrice ?? "0.00")
                : "0.00",
            ...financialData,
            ...targetFields,
            notes:
              sourceIsFixedAsset && sourceItem.lineObservation
                ? sourceItem.lineObservation
                : item.notes?.trim() || closeNote,
            isFixedAsset: sourceIsFixedAsset || isFixedAsset,
            isLeasing: sourceIsFixedAsset
              ? sourceItem.isLeasing === true
              : isFixedAsset
                ? item.isLeasing === true
                : false,
            assetDetails:
              sourceIsFixedAsset || isFixedAsset ? fixedAssetDetails : [],
            closeRemaining:
              input.sourceType === "transfer" ? item.closeRemaining : undefined,
            closeReason:
              input.sourceType === "transfer" ? item.closeReason : undefined,
            closeNote:
              input.sourceType === "transfer" ? item.closeNote : undefined,
            closedById:
              input.sourceType === "transfer" && item.closeRemaining
                ? ctx.user.id
                : undefined,
          };
        })
      );

      return otherCharges.length > 0
        ? db.registerReceipt(receiptData, receiptItems, otherCharges)
        : db.registerReceipt(receiptData, receiptItems);
    }),
});
