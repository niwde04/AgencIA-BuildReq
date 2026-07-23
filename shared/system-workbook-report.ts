import {
  buildDmcReportPayload,
  type DmcReportSourceInvoice,
  type DmcStatusMode,
} from "./dmc-report";
import { roundPurchaseOrderMoney } from "./purchase-orders";

export const SYSTEM_ORDER_HEADERS = [
  "Orden Compra",
  "Job",
  "Código Finanzas",
  "Fecha",
  "Rtn",
  "Proveedor",
  "Asesor De Venta",
  "Moneda",
  "Pedido:",
  "Item",
  "No. Parte",
  "Descripcion",
  "Cantidad",
  "V Unitario",
  "Subtotal",
  "Isv",
  "Total",
  "Tipo_De_Compra",
  "Solicitado",
  "F Entrega",
  "Destino",
  "Cotizacion",
  "Estado",
] as const;

export const SYSTEM_INVOICE_HEADERS = [
  "N° Registro",
  "Cod_Finanzas",
  "Rtn",
  "Razón Social",
  "Sistema_De_Pago",
  "Tipo_De_Comprobante",
  "Fecha Factura",
  "Nro. Factura",
  "Cai Factura",
  "Descripcion_Fac.",
  "Base_Isv_15%",
  "Base_Isv_18%",
  "Isv_4%",
  "Base_Isv_0%",
  "Anticipo",
  "No_Cpte_Retención",
  "Cai Ret.",
  "Fech_Cpte_Retención",
  "Empresa",
  "Total_Base",
  "Isv_15%",
  "Ice_18%",
  "Turismo 4%.",
  "Total_Factura",
  "Ret_Isr_1%",
  "Ret_Isr_12.5%",
  "Ret_Isr_25%",
  "Ret_Isv 15%.",
  "Total_Retencion.",
  "Neto_Pagar",
  "Fecha Vencimiento Crédito",
  "Tipo_de_compra",
] as const;

export type SystemPurchaseOrderLine = {
  orderNumber: string;
  job: string;
  financialCode: string;
  date: Date | string | null;
  supplierRtn: string;
  supplierName: string;
  salesAdvisor: string;
  currency: string;
  orderId: number;
  itemNumber: number;
  partNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  tax: number;
  total: number;
  purchaseType: string;
  requestedBy: string;
  deliveryDate: Date | string | null;
  destination: string;
  quoteReference: string;
  status: string;
};

export type SystemWorkbookPayload = {
  purchaseOrders: SystemPurchaseOrderLine[];
  invoices: Array<Record<(typeof SYSTEM_INVOICE_HEADERS)[number], string | number | Date | null>>;
  summary: {
    generatedAt: Date;
    dateFrom: Date | null;
    dateTo: Date | null;
    statusMode: DmcStatusMode;
    purchaseOrderLineCount: number;
    invoiceLineCount: number;
    invoiceCount: number;
    purchaseOrderTotal: number;
    invoiceTotal: number;
    retentionTotal: number;
    netPayable: number;
  };
};

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return roundPurchaseOrderMoney(Number.isFinite(parsed) ? parsed : 0);
}

export function buildSystemWorkbookPayload(
  invoices: DmcReportSourceInvoice[],
  purchaseOrders: SystemPurchaseOrderLine[],
  params: {
    generatedAt?: Date;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
    statusMode?: DmcStatusMode;
  } = {}
): SystemWorkbookPayload {
  let registration = 0;
  const invoiceRows = invoices.flatMap(invoice => {
    const rows = buildDmcReportPayload([invoice]).rows;
    return rows.map((row, itemIndex) => {
      const invoiceItem = invoice.items[itemIndex];
      registration += 1;
      return {
        "N° Registro": registration,
        Cod_Finanzas: String(
          invoiceItem?.financialGroupCode ?? row.codFinanzas ?? ""
        ),
        Rtn: String(row.rtn ?? ""),
        "Razón Social": String(row.razonSocial ?? ""),
        Sistema_De_Pago: String(row.sistemaDePago ?? ""),
        Tipo_De_Comprobante: String(row.tipoDeComprobante ?? ""),
        "Fecha Factura": dateValue(row.fechaFactura as Date | string | null),
        "Nro. Factura":
          invoice.invoiceNumber || invoice.invoiceDocumentNumber,
        "Cai Factura": String(row.cai ?? ""),
        "Descripcion_Fac.": String(
          invoiceItem?.articleDescription ||
            invoiceItem?.itemName ||
            row.descripcionFactura ||
            ""
        ),
        "Base_Isv_15%": money(row.baseIsv15),
        "Base_Isv_18%": money(row.baseIsv18),
        "Isv_4%": money(row.baseIsv4),
        "Base_Isv_0%": money(row.baseIsv0),
        Anticipo: money(row.anticipo),
        "No_Cpte_Retención": String(row.noComprobanteRetencion ?? ""),
        "Cai Ret.": invoice.retentionCai ?? "",
        "Fech_Cpte_Retención": dateValue(invoice.retentionDocumentDate),
        Empresa: [invoice.projectCode, invoice.projectName]
          .filter(Boolean)
          .join(" - "),
        Total_Base: money(row.totalBase),
        "Isv_15%": money(row.isv15),
        "Ice_18%": money(row.isv18),
        "Turismo 4%.": money(row.isv4),
        Total_Factura: money(row.totalFactura),
        "Ret_Isr_1%": money(row.retIsr1),
        "Ret_Isr_12.5%": money(row.retIsr12_5),
        "Ret_Isr_25%": money(row.retIsr25),
        "Ret_Isv 15%.": money(row.retIsv),
        "Total_Retencion.": money(row.totalRetencion),
        Neto_Pagar: money(row.netoPagar),
        "Fecha Vencimiento Crédito": dateValue(row.fechaVencimiento as Date | string | null),
        Tipo_de_compra: invoice.purchaseType ?? "",
      };
    });
  });

  return {
    purchaseOrders,
    invoices: invoiceRows,
    summary: {
      generatedAt: params.generatedAt ?? new Date(),
      dateFrom: dateValue(params.dateFrom),
      dateTo: dateValue(params.dateTo),
      statusMode: params.statusMode ?? "non_void",
      purchaseOrderLineCount: purchaseOrders.length,
      invoiceLineCount: invoiceRows.length,
      invoiceCount: invoices.length,
      purchaseOrderTotal: money(
        purchaseOrders.reduce((sum, row) => sum + row.total, 0)
      ),
      invoiceTotal: money(
        invoiceRows.reduce((sum, row) => sum + money(row.Total_Factura), 0)
      ),
      retentionTotal: money(
        invoiceRows.reduce(
          (sum, row) => sum + money(row["Total_Retencion."]),
          0
        )
      ),
      netPayable: money(
        invoiceRows.reduce((sum, row) => sum + money(row.Neto_Pagar), 0)
      ),
    },
  };
}
