import { TRPCError } from "@trpc/server";
import {
  isMissingCpcRequiredRetention,
  requiresMissingCpcRetention,
} from "@shared/supplier-documents";
import type { getInvoiceById } from "./db";

type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>;

export function assertInvoicePendingAccounting(detail: InvoiceDetail) {
  if (detail.invoice.status !== "pendiente_contabilizar") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Envíe primero la factura a contabilizar desde Facturas",
    });
  }
}

export function assertRequiredMissingCpcRetention(detail: InvoiceDetail) {
  const withholdingBase = (detail.items ?? [])
    .filter(item => item.allowsTaxWithholding !== false)
    .reduce((sum, item) => {
      const subtotal = Number(String(item.subtotal ?? 0).replace(/,/g, ""));
      return sum + (Number.isFinite(subtotal) ? subtotal : 0);
    }, 0);
  if (
    !requiresMissingCpcRetention({
      isFiscalDocument: detail.invoice.isFiscalDocument,
      certificateStatus: detail.accountPaymentCertificate?.status,
      retentionPolicy: detail.retentionPolicy,
      withholdingBase,
    })
  ) {
    return;
  }
  if (!detail.invoice.documentDate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Seleccione la fecha de emisión de la factura antes de continuar",
    });
  }

  const hasRequiredRetention = (detail.retentions ?? []).some(retention =>
    isMissingCpcRequiredRetention({
      taxCode: retention.retentionCode,
      ratePercent: retention.percentage,
    })
  );
  if (!hasRequiredRetention) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "El proveedor no tiene una CPC vigente para la fecha de emisión de la factura. Registre la retención RT01 (1%) antes de continuar.",
    });
  }
}
