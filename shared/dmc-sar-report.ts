import type { DmcReportSourceInvoice } from "./dmc-report";
import type { PurchaseOrderTaxBreakdownEntry } from "./purchase-orders";
import { roundPurchaseOrderMoney } from "./purchase-orders";

export type DmcSarStatusMode = "non_void" | "registered_only" | "all";
export type DmcSarCellValue = string | number | Date | null;

export type DmcSarLocalPurchaseRow = {
  rtnProveedor: string;
  razonSocialProveedor: string;
  fecha: Date | null;
  cai: string;
  establecimiento: string;
  puntoEmision: string;
  tipoDocumento: string;
  correlativo: string;
  compraConOce: string;
  oceResolutionNumber: string;
  oceResolutionDate: Date | null;
  importeExento: number | null;
  importeGravado15: number | null;
  importeGravado18: number | null;
  impuesto15: number | null;
  impuesto18: number | null;
};

export type DmcSarOtherReceiptRow = {
  tipoDocumento: string;
  fecha: Date | null;
  rtnProveedor: string;
  razonSocialProveedor: string;
  numeroDocumentoEquivalente: string;
  compraConOce: string;
  oceResolutionNumber: string;
  oceResolutionDate: Date | null;
  importeExento: number | null;
  importeGravado15: number | null;
  importeGravado18: number | null;
  impuesto15: number | null;
  impuesto18: number | null;
};

export type DmcSarOccasionalPurchaseRow = {
  rtn: string;
  identidadOCarnetResidencia: string;
  pasaporte: string;
  razonSocialProveedor: string;
  departamento: string;
  municipio: string;
  descripcionProductoServicio: string;
  fecha: Date | null;
  cai: string;
  establecimiento: string;
  puntoEmision: string;
  tipoDocumento: string;
  correlativo: string;
  importeExento: number | null;
  importeGravado15: number | null;
  importeGravado18: number | null;
  impuesto15: number | null;
  impuesto18: number | null;
};

export type DmcSarImportRow = {
  identificadorTributarioProveedor: string;
  razonSocialProveedor: string;
  numeroDua: string;
  numeroLiquidacion: string;
  numeroResolucionExoneracionSefin: string;
  fechaVencimientoResolucion: Date | null;
};

export type DmcSarReportSummary = {
  generatedAt: Date;
  source: string;
  dateFrom: Date | null;
  dateTo: Date | null;
  statusMode: DmcSarStatusMode;
  invoiceCount: number;
  detalleComprasCount: number;
  otrosComprobantesCount: number;
  comprasEventualesCount: number;
  importacionesCount: number;
  isv4InvoiceCount: number;
  isv4BaseTotal: number;
  isv4TaxTotal: number;
};

export type DmcSarReportPayload = {
  detalleCompras: DmcSarLocalPurchaseRow[];
  otrosComprobantes: DmcSarOtherReceiptRow[];
  comprasEventuales: DmcSarOccasionalPurchaseRow[];
  detalleImportaciones: DmcSarImportRow[];
  summary: DmcSarReportSummary;
};

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number | null | undefined) {
  return roundPurchaseOrderMoney(toNumber(value));
}

function amountOrBlank(value: string | number | null | undefined) {
  const amount = money(value);
  return amount === 0 ? null : amount;
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTaxBreakdown(
  value: PurchaseOrderTaxBreakdownEntry[] | string | null | undefined
): PurchaseOrderTaxBreakdownEntry[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRate(value: string | number | null | undefined, expected: number) {
  return Math.abs(toNumber(value) - expected) < 0.0001;
}

function taxMatches(
  entry: Pick<PurchaseOrderTaxBreakdownEntry, "taxCode" | "ratePercent">,
  code: string,
  rate: number
) {
  return entry.taxCode === code || isRate(entry.ratePercent, rate);
}

function splitInvoiceNumber(value: string | null | undefined) {
  const parts = String(value ?? "").split("-");
  if (parts.length >= 4) {
    return {
      establecimiento: parts[0] ?? "",
      puntoEmision: parts[1] ?? "",
      tipoDocumento: parts[2] ?? "",
      correlativo: parts.slice(3).join("-"),
    };
  }

  const compact = String(value ?? "").replace(/\D/g, "");
  return {
    establecimiento: compact.length >= 16 ? compact.slice(0, 3) : "",
    puntoEmision: compact.length >= 16 ? compact.slice(3, 6) : "",
    tipoDocumento: compact.length >= 8 ? compact.slice(6, 8) : "",
    correlativo: compact.length >= 16 ? compact.slice(8, 16) : compact,
  };
}

function summarizeTaxes(items: DmcReportSourceInvoice["items"]) {
  const summary = {
    baseIsv15: 0,
    baseIsv18: 0,
    baseIsv4: 0,
    baseIsv0: 0,
    isv15: 0,
    isv18: 0,
    isv4: 0,
  };

  for (const item of items) {
    const subtotal = money(item.subtotal);
    const itemTaxAmount = money(item.taxAmount);
    const breakdown = parseTaxBreakdown(item.taxBreakdown);
    const baseEntries = breakdown.filter(entry => entry.taxType === "base");

    if (baseEntries.length === 0) {
      if (item.taxCode === "isv_15") {
        summary.baseIsv15 += subtotal;
        summary.isv15 += itemTaxAmount;
      } else if (item.taxCode === "isv_18") {
        summary.baseIsv18 += subtotal;
        summary.isv18 += itemTaxAmount;
      } else if (item.taxCode === "isv_4") {
        summary.baseIsv4 += subtotal;
        summary.isv4 += itemTaxAmount;
      } else {
        summary.baseIsv0 += subtotal;
      }
      continue;
    }

    for (const entry of baseEntries) {
      const baseAmount = money(entry.baseAmount ?? subtotal);
      if (entry.fiscalCategory === "gravado" && taxMatches(entry, "isv_15", 15)) {
        summary.baseIsv15 += baseAmount;
      } else if (entry.fiscalCategory === "gravado" && taxMatches(entry, "isv_18", 18)) {
        summary.baseIsv18 += baseAmount;
      } else if (entry.fiscalCategory === "gravado" && taxMatches(entry, "isv_4", 4)) {
        summary.baseIsv4 += baseAmount;
      } else if (toNumber(entry.ratePercent) === 0) {
        summary.baseIsv0 += baseAmount;
      }
    }

    for (const entry of breakdown) {
      if (taxMatches(entry, "isv_15", 15)) {
        summary.isv15 += money(entry.amount);
      } else if (taxMatches(entry, "isv_18", 18)) {
        summary.isv18 += money(entry.amount);
      } else if (taxMatches(entry, "isv_4", 4)) {
        summary.isv4 += money(entry.amount);
      }
    }
  }

  return {
    baseIsv15: money(summary.baseIsv15),
    baseIsv18: money(summary.baseIsv18),
    baseIsv4: money(summary.baseIsv4),
    baseIsv0: money(summary.baseIsv0),
    isv15: money(summary.isv15),
    isv18: money(summary.isv18),
    isv4: money(summary.isv4),
  };
}

function getDocumentDate(invoice: DmcReportSourceInvoice) {
  return normalizeDate(
    invoice.documentDate ?? invoice.receiptDate ?? invoice.postingDate
  );
}

function getExemptAmount(
  invoice: DmcReportSourceInvoice,
  taxes: ReturnType<typeof summarizeTaxes>
) {
  return invoice.hasOceExemption === true
    ? money(invoice.oceExemptAmount)
    : taxes.baseIsv0;
}

function getOceFlag(invoice: DmcReportSourceInvoice) {
  return invoice.hasOceExemption === true ? "SI" : "NO";
}

function buildLocalRow(
  invoice: DmcReportSourceInvoice,
  taxes: ReturnType<typeof summarizeTaxes>
): DmcSarLocalPurchaseRow {
  const numberParts = splitInvoiceNumber(invoice.invoiceNumber);
  return {
    rtnProveedor: invoice.supplierRtn ?? "",
    razonSocialProveedor: invoice.supplierName ?? "",
    fecha: getDocumentDate(invoice),
    cai: invoice.cai ?? "",
    establecimiento: numberParts.establecimiento,
    puntoEmision: numberParts.puntoEmision,
    tipoDocumento: "01",
    correlativo: numberParts.correlativo,
    compraConOce: getOceFlag(invoice),
    oceResolutionNumber:
      invoice.hasOceExemption === true ? invoice.oceResolutionNumber ?? "" : "",
    oceResolutionDate:
      invoice.hasOceExemption === true
        ? normalizeDate(invoice.oceResolutionDate)
        : null,
    importeExento: amountOrBlank(getExemptAmount(invoice, taxes)),
    importeGravado15: amountOrBlank(taxes.baseIsv15),
    importeGravado18: amountOrBlank(taxes.baseIsv18),
    impuesto15: amountOrBlank(taxes.isv15),
    impuesto18: amountOrBlank(taxes.isv18),
  };
}

function buildOtherReceiptRow(
  invoice: DmcReportSourceInvoice,
  taxes: ReturnType<typeof summarizeTaxes>
): DmcSarOtherReceiptRow {
  const numberParts = splitInvoiceNumber(invoice.invoiceNumber);
  return {
    tipoDocumento: numberParts.tipoDocumento,
    fecha: getDocumentDate(invoice),
    rtnProveedor: invoice.supplierRtn ?? "",
    razonSocialProveedor: invoice.supplierName ?? "",
    numeroDocumentoEquivalente:
      invoice.invoiceNumber || invoice.invoiceDocumentNumber || "",
    compraConOce: getOceFlag(invoice),
    oceResolutionNumber:
      invoice.hasOceExemption === true ? invoice.oceResolutionNumber ?? "" : "",
    oceResolutionDate:
      invoice.hasOceExemption === true
        ? normalizeDate(invoice.oceResolutionDate)
        : null,
    importeExento: amountOrBlank(getExemptAmount(invoice, taxes)),
    importeGravado15: amountOrBlank(taxes.baseIsv15),
    importeGravado18: amountOrBlank(taxes.baseIsv18),
    impuesto15: amountOrBlank(taxes.isv15),
    impuesto18: amountOrBlank(taxes.isv18),
  };
}

function buildImportRow(invoice: DmcReportSourceInvoice): DmcSarImportRow {
  return {
    identificadorTributarioProveedor: invoice.supplierRtn ?? "",
    razonSocialProveedor: invoice.supplierName ?? "",
    numeroDua: "",
    numeroLiquidacion: "",
    numeroResolucionExoneracionSefin: "",
    fechaVencimientoResolucion: null,
  };
}

function isForeignPurchase(invoice: DmcReportSourceInvoice) {
  return invoice.purchaseType === "extranjera";
}

function isLocalFiscalInvoice(invoice: DmcReportSourceInvoice) {
  return splitInvoiceNumber(invoice.invoiceNumber).tipoDocumento === "01";
}

export function buildDmcSarReportPayload(
  invoices: DmcReportSourceInvoice[],
  params: {
    generatedAt?: Date;
    source?: string;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
    statusMode?: DmcSarStatusMode;
  } = {}
): DmcSarReportPayload {
  const detalleCompras: DmcSarLocalPurchaseRow[] = [];
  const otrosComprobantes: DmcSarOtherReceiptRow[] = [];
  const detalleImportaciones: DmcSarImportRow[] = [];
  let isv4InvoiceCount = 0;
  let isv4BaseTotal = 0;
  let isv4TaxTotal = 0;

  for (const invoice of invoices) {
    const taxes = summarizeTaxes(invoice.items);
    if (taxes.baseIsv4 || taxes.isv4) {
      isv4InvoiceCount += 1;
      isv4BaseTotal += taxes.baseIsv4;
      isv4TaxTotal += taxes.isv4;
    }

    if (isForeignPurchase(invoice)) {
      detalleImportaciones.push(buildImportRow(invoice));
    } else if (isLocalFiscalInvoice(invoice)) {
      detalleCompras.push(buildLocalRow(invoice, taxes));
    } else {
      otrosComprobantes.push(buildOtherReceiptRow(invoice, taxes));
    }
  }

  return {
    detalleCompras,
    otrosComprobantes,
    comprasEventuales: [],
    detalleImportaciones,
    summary: {
      generatedAt: params.generatedAt ?? new Date(),
      source: params.source ?? "Base actual de BuildReq",
      dateFrom: normalizeDate(params.dateFrom),
      dateTo: normalizeDate(params.dateTo),
      statusMode: params.statusMode ?? "non_void",
      invoiceCount: invoices.length,
      detalleComprasCount: detalleCompras.length,
      otrosComprobantesCount: otrosComprobantes.length,
      comprasEventualesCount: 0,
      importacionesCount: detalleImportaciones.length,
      isv4InvoiceCount,
      isv4BaseTotal: money(isv4BaseTotal),
      isv4TaxTotal: money(isv4TaxTotal),
    },
  };
}
