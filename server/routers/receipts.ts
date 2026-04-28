import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";

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
    user.buildreqRole === "administrador_proyecto"
  );
}

const receiptItemSchema = z.object({
  sourceItemId: z.number(),
  itemName: z.string().min(1),
  quantityExpected: z.string().min(1),
  quantityReceived: z.string().min(1),
  unit: z.string().optional(),
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
        ctx.user.buildreqRole === "administrador_proyecto"
          ? ctx.user.assignedProjectId ?? undefined
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
      return detail;
    }),

  register: protectedProcedure
    .input(
      z
        .object({
          sourceType: z.enum(["purchase_order", "transfer"]),
          sourceId: z.number(),
          projectId: z.number(),
          cai: z.string().trim().max(100).optional(),
          invoiceNumber: z.string().trim().max(100).optional(),
          documentDate: z.string().optional(),
          postingDate: z.string(),
          receiptDate: z.string().optional(),
          notes: z.string().optional(),
          items: z.array(receiptItemSchema).min(1),
        })
        .superRefine((value, ctx) => {
          if (value.sourceType === "purchase_order") {
            if (!value.cai?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["cai"],
                message: "Ingrese el CAI de la factura",
              });
            }
            if (!value.invoiceNumber?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["invoiceNumber"],
                message: "Ingrese el número de factura",
              });
            }
            if (!value.documentDate) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["documentDate"],
                message: "Seleccione la fecha del documento",
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

        if (!RECEIVABLE_PURCHASE_ORDER_STATUSES.has(detail.purchaseOrder.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden recibir órdenes emitidas con saldo pendiente",
          });
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

          const pendingQuantity = Math.max(
            Number(sourceItem.quantity ?? 0) - Number(sourceItem.receivedQuantity ?? 0),
            0
          );
          const requestedQuantity = Number(item.quantityReceived ?? 0);

          if (requestedQuantity > pendingQuantity) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La cantidad a recibir de ${sourceItem.itemName} excede lo pendiente`,
            });
          }

          if (requestedQuantity > 0) {
            hasPositiveReceipt = true;
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

          if (requestedQuantity > pendingQuantity) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La cantidad a recibir de ${sourceItem.itemName} excede lo pendiente`,
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

      return db.registerReceipt(
        {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          projectId: input.projectId,
          receivedById: ctx.user.id,
          status: "pendiente",
          cai: input.cai?.trim() || null,
          invoiceNumber: input.invoiceNumber?.trim() || null,
          documentDate: input.documentDate ? parseDateInput(input.documentDate) : null,
          postingDate: parseDateInput(input.postingDate),
          receiptDate: parseDateInput(input.receiptDate || input.postingDate),
          notes: input.notes,
        },
        input.items.map((item) => ({
          sourceItemId: item.sourceItemId,
          itemName: item.itemName,
          quantityExpected: item.quantityExpected,
          quantityReceived: item.quantityReceived,
          unit: item.unit,
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
