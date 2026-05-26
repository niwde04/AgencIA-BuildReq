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
  isValidInvoiceNumber,
} from "@shared/invoices";

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

function canAccessReceipts(user: { role: string; buildreqRole?: string | null }) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

function assertProjectScopedAccess(
  user: { role: string; buildreqRole?: string | null; assignedProjectId?: number | null },
  projectId: number
) {
  if (user.role === "admin") return;
  if (
    user.buildreqRole !== "administrador_proyecto" &&
    user.buildreqRole !== "bodeguero_proyecto"
  ) {
    return;
  }
  if (user.assignedProjectId !== projectId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a recepciones de otro proyecto",
    });
  }
}

const receiptItemSchema = z.object({
  sourceItemId: z.number(),
  itemName: z.string().min(1),
  quantityExpected: z.string().min(1),
  quantityReceived: z.string().min(1),
  unit: z.string().optional(),
  unitPrice: z.string().trim().optional(),
  notes: z.string().optional(),
  closeRemaining: z.boolean().optional(),
  closeReason: z.string().trim().max(120).optional(),
  closeNote: z.string().trim().max(1000).optional(),
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
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
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
    user.assignedProjectId === destinationProjectId
  );
}

export const receiptsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.number().optional(),
          sourceType: z.enum(["purchase_order", "transfer"]).optional(),
          status: z
            .enum(["pendiente", "parcial", "completa", "cierre_incompleto"])
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

      const projectId =
        ctx.user.buildreqRole === "administrador_proyecto" ||
        ctx.user.buildreqRole === "bodeguero_proyecto"
          ? ctx.user.assignedProjectId ?? -1
          : input?.projectId;

      return db.listReceipts({
        ...input,
        projectId,
      });
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
          documentDate: z.string().optional(),
          postingDate: z.string(),
          receiptDate: z.string().optional(),
          emissionDeadline: z.string().optional(),
          notes: z.string().optional(),
          items: z.array(receiptItemSchema).min(1),
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
            if (!value.documentDate) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentDate"],
                message: "Seleccione la fecha del documento",
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

        if (!RECEIVABLE_PURCHASE_ORDER_STATUSES.has(detail.purchaseOrder.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden recibir órdenes emitidas con saldo pendiente",
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
              message: "La OC de contrato no tiene una programación de pagos válida",
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

        const itemsById = new Map((detail.items ?? []).map((item: any) => [item.id, item]));
        let hasPositiveReceipt = false;

        for (const item of input.items) {
          const sourceItem = itemsById.get(item.sourceItemId);
          if (!sourceItem) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La recepción incluye un ítem que ya no existe en la orden",
            });
          }

          if (sourceItem.receiptClosed) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La línea ${sourceItem.itemName} fue cerrada y ya no admite recepciones`,
            });
          }

          const requestedQuantity = Number(item.quantityReceived ?? 0);

          if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La cantidad a recibir de ${sourceItem.itemName} debe ser cero o mayor`,
            });
          }

          if (requestedQuantity > 0) {
            hasPositiveReceipt = true;
          }

          const unitPrice = Number(item.unitPrice ?? 0);
          if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `El precio confirmado de ${sourceItem.itemName} debe ser cero o mayor`,
            });
          }
        }

        if (!hasPositiveReceipt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ingrese al menos una cantidad mayor que cero para registrar la recepción",
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
        if (typeof destinationProjectId === "number") {
          assertProjectScopedAccess(ctx.user, destinationProjectId);
          if (input.projectId !== destinationProjectId) {
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
            message: "Solo se pueden recibir traslados confirmados o con saldo pendiente",
          });
        }

        const itemsById = new Map((detail.items ?? []).map((item: any) => [item.id, item]));
        let hasPositiveReceipt = false;
        let hasTransferClosure = false;

        for (const item of input.items) {
          const sourceItem = itemsById.get(item.sourceItemId);
          if (!sourceItem) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La recepción incluye un ítem que ya no existe en el traslado",
            });
          }

          const pendingQuantity = getTransferPendingQuantity(sourceItem);
          const requestedQuantity = Number(item.quantityReceived ?? 0);
          const closeQuantity = item.closeRemaining
            ? Math.max(pendingQuantity - requestedQuantity, 0)
            : 0;

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

      return db.registerReceipt(
        {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          projectId: input.projectId,
          receivedById: ctx.user.id,
          status: "pendiente",
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
          documentDate: input.documentDate ? parseDateInput(input.documentDate) : null,
          postingDate: parseDateInput(input.postingDate),
          receiptDate: parseDateInput(input.receiptDate || input.postingDate),
          emissionDeadline: input.emissionDeadline
            ? parseDateInput(input.emissionDeadline)
            : null,
          notes: input.notes,
        },
        input.items.map((item) => ({
          sourceItemId: item.sourceItemId,
          itemName: item.itemName,
          quantityExpected: item.quantityExpected,
          quantityReceived: item.quantityReceived,
          unit: item.unit,
          unitPrice:
            input.sourceType === "purchase_order"
              ? item.unitPrice ?? "0.00"
              : "0.00",
          notes:
            item.notes ??
            (input.sourceType === "transfer" && item.closeRemaining
              ? [
                  "Cierre incompleto con devolución al origen y regreso a requisición.",
                  item.closeReason ? `Motivo: ${item.closeReason}.` : null,
                  item.closeNote ? `Nota: ${item.closeNote}` : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : undefined),
          closeRemaining:
            input.sourceType === "transfer" ? item.closeRemaining : undefined,
          closeReason:
            input.sourceType === "transfer" ? item.closeReason : undefined,
          closeNote: input.sourceType === "transfer" ? item.closeNote : undefined,
          closedById:
            input.sourceType === "transfer" && item.closeRemaining
              ? ctx.user.id
              : undefined,
        }))
      );
    }),
});
