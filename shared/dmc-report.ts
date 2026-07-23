import {
  getDocumentTypeCodeFromNumber,
  getDocumentTypeLabelFromNumber,
} from "./invoices";
import type { PurchaseOrderTaxBreakdownEntry } from "./purchase-orders";
import { roundPurchaseOrderMoney } from "./purchase-orders";

export type DmcStatusMode = "non_void" | "registered_only" | "all";

export type DmcCellValue = string | number | Date | null;

export const DMC_COLUMNS = [
  { key: "numeroRegistro", header: "N° REGISTRO", width: 14, numFmt: "#,##0" },
  { key: "codFinanzas", header: "Cod_Finanzas", width: 16 },
  { key: "nombreGrupoFinanciero", header: "Nombre_Grupo_Financiero", width: 44 },
  { key: "codigoSap", header: "Código SAP", width: 18 },
  { key: "rtn", header: "RTN", width: 18 },
  { key: "razonSocial", header: "Razón Social", width: 36 },
  { key: "sistemaDePago", header: "Sistema_de_Pago", width: 18 },
  { key: "moneda", header: "Moneda", width: 12 },
  { key: "tipoDeComprobante", header: "Tipo_de_comprobante", width: 24 },
  { key: "fechaFactura", header: "Fecha Factura", width: 14, numFmt: "yyyy-mm-dd" },
  { key: "establecimiento", header: "ESTABLECIMIENTO", width: 16 },
  { key: "puntoEmision", header: "PUNTO DE EMISIÓN", width: 18 },
  { key: "tipoDocumento", header: "TIPO DE DOCUMENTO", width: 18 },
  { key: "correlativo", header: "CORRELATIVO", width: 18 },
  { key: "cai", header: "CAI", width: 38 },
  { key: "descripcionFactura", header: "Descripcion_Fac.", width: 44 },
  { key: "diasCredito", header: "Dias_crédito", width: 14, numFmt: "#,##0" },
  { key: "baseIsv15", header: "Base_ISV_15%", width: 16, numFmt: "#,##0.00" },
  { key: "baseIsv18", header: "Base_ISV_18%", width: 16, numFmt: "#,##0.00" },
  { key: "baseIsv4", header: "ISV_4%", width: 16, numFmt: "#,##0.00" },
  { key: "baseIsv0", header: "Base_ISV_0%", width: 16, numFmt: "#,##0.00" },
  { key: "anticipo", header: "Anticipo", width: 14, numFmt: "#,##0.00" },
  { key: "noComprobanteRetencion", header: "No_Cpte_Retención", width: 22 },
  { key: "fechaComprobanteRetencion", header: "Fech_Cpte_Retención", width: 20, numFmt: "yyyy-mm-dd" },
  { key: "criterioRetIsr1", header: "Criterio_Ret_ISR_1%", width: 24 },
  { key: "criterioRetIsr12_5", header: "Criterio_Ret_ISR_12.5%", width: 26 },
  { key: "criterioRetIsr25", header: "Criterio_Ret_ISR_25%", width: 24 },
  { key: "criterioRetIsv", header: "Ret_ISV", width: 22 },
  { key: "empresa", header: "Empresa", width: 18 },
  { key: "sucursal", header: "Sucursal", width: 28 },
  { key: "totalBase", header: "Total_base", width: 16, numFmt: "#,##0.00" },
  { key: "isv15", header: "ISV_15%", width: 14, numFmt: "#,##0.00" },
  { key: "isv18", header: "ISV_18%", width: 14, numFmt: "#,##0.00" },
  { key: "isv4", header: "ISV_4%.", width: 14, numFmt: "#,##0.00" },
  { key: "totalIsv", header: "Total_ISV", width: 14, numFmt: "#,##0.00" },
  { key: "totalFactura", header: "Total_Factura", width: 16, numFmt: "#,##0.00" },
  { key: "retIsr1", header: "Ret_ISR_1%", width: 14, numFmt: "#,##0.00" },
  { key: "retIsr12_5", header: "Ret_ISR_12.5%", width: 16, numFmt: "#,##0.00" },
  { key: "retIsr25", header: "Ret_ISR_25%", width: 14, numFmt: "#,##0.00" },
  { key: "retIsv", header: "Ret_ISV.", width: 14, numFmt: "#,##0.00" },
  { key: "totalRetencion", header: "Total_Retencion.", width: 18, numFmt: "#,##0.00" },
  { key: "netoPagar", header: "Neto_pagar", width: 16, numFmt: "#,##0.00" },
  { key: "fechaVencimiento", header: "F_Vencimiento", width: 14, numFmt: "yyyy-mm-dd" },
  { key: "tipoPago", header: "Tipo_de_pago", width: 18 },
  { key: "statusPago", header: "Status_Pago", width: 18 },
  { key: "lotePago", header: "Lote de Pago", width: 16 },
  { key: "cuentaBancaria", header: "Cta. Bancaria", width: 18 },
  { key: "fechaPago", header: "Fecha", width: 14, numFmt: "yyyy-mm-dd" },
  { key: "referenciaDebito", header: "Referencia Debito", width: 20 },
  { key: "refNotificacion", header: "Ref Notificacion", width: 20 },
  { key: "observacion", header: "Observacion", width: 32 },
  { key: "sinFondos", header: "S_fondos", width: 14 },
  { key: "grupoMayor", header: "Grupo mayor", width: 18 },
  { key: "flujoId", header: "Flujo ID", width: 20 },
  { key: "actividadFlujo", header: "Actividad Flujo", width: 22 },
  { key: "job", header: "JOB", width: 24 },
  { key: "level1", header: "Level1", width: 22 },
  { key: "level2", header: "Level2", width: 28 },
  { key: "level3", header: "Level3", width: 28 },
  { key: "level4", header: "Level4", width: 18 },
  { key: "diasVencimiento", header: "D_Vencimiento", width: 16, numFmt: "#,##0" },
  { key: "noProvision", header: "No Provision", width: 18 },
  { key: "guiaDocumentos", header: "Guia_R_Documentos", width: 22 },
] as const satisfies readonly {
  key: string;
  header: string;
  width?: number;
  numFmt?: string;
}[];

export type DmcReportColumnKey = (typeof DMC_COLUMNS)[number]["key"];
export type DmcReportRow = Record<DmcReportColumnKey, DmcCellValue>;

export type DmcReportSourceItem = {
  id: number;
  itemName: string;
  sapItemCode?: string | null;
  articleDescription?: string | null;
  financialGroupCode?: string | null;
  financialGroupDescription?: string | null;
  taxCode?: string | null;
  subtotal?: string | number | null;
  taxAmount?: string | number | null;
  total?: string | number | null;
  taxBreakdown?: PurchaseOrderTaxBreakdownEntry[] | string | null;
  dmcDestination?: "costo" | "gasto" | "no_deducible" | null;
};

export type DmcReportSourceRetention = {
  id: number;
  retentionCode?: string | null;
  retentionErpCode?: string | null;
  description?: string | null;
  percentage?: string | number | null;
  baseAmount?: string | number | null;
  amount?: string | number | null;
  invoiceItemId?: number | null;
};

export type DmcReportSourceMaterialRequest = {
  id: number;
  requestNumber: string;
  assignedFlow?: string | null;
};

export type DmcReportSourceInvoice = {
  invoiceId: number;
  invoiceDocumentNumber: string;
  invoiceNumber?: string | null;
  status: string;
  isFiscalDocument?: boolean | null;
  cai?: string | null;
  documentDate?: Date | string | null;
  documentDueDate?: Date | string | null;
  postingDate?: Date | string | null;
  receiptDate?: Date | string | null;
  retentionReceiptNumber?: string | null;
  retentionCai?: string | null;
  retentionDocumentDate?: Date | string | null;
  hasOceExemption?: boolean | null;
  oceResolutionNumber?: string | null;
  oceResolutionDate?: Date | string | null;
  oceExemptAmount?: string | number | null;
  oceNumber?: string | null;
  oceExemptAmount15?: string | number | null;
  oceExemptAmount18?: string | number | null;
  dmcForeignSection?: "fyduca" | "importacion" | null;
  dmcForeignIdentification?: string | null;
  dmcFyducaNumber?: string | null;
  dmcDuaNumber?: string | null;
  dmcImportOutsideCentralAmerica?: boolean | null;
  subtotal?: string | number | null;
  taxAmount?: string | number | null;
  total?: string | number | null;
  retentionTotal?: string | number | null;
  netPayable?: string | number | null;
  receiptNumber?: string | null;
  purchaseOrderNumber?: string | null;
  purchaseType?: string | null;
  purchaseOrderPaymentMethod?: string | null;
  currency?: "HNL" | "USD" | null;
  projectCode?: string | null;
  projectName?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  supplierRtn?: string | null;
  items: DmcReportSourceItem[];
  retentions: DmcReportSourceRetention[];
  materialRequests: DmcReportSourceMaterialRequest[];
  subProjectLabels: string[];
};

export type DmcReportSummary = {
  generatedAt: Date;
  source: string;
  dateFrom: Date | null;
  dateTo: Date | null;
  statusMode: DmcStatusMode;
  invoiceCount: number;
  totalsByCurrency: Array<{
    currency: "HNL" | "USD";
    invoiceCount: number;
    totalBase: number;
    totalIsv: number;
    totalFactura: number;
    totalRetencion: number;
    netoPagar: number;
  }>;
};

export type DmcReportPayload = {
  rows: DmcReportRow[];
  summary: DmcReportSummary;
};

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  revisada: "Enviada a revisión",
  rechazada: "Rechazada",
  registrada: "Contabilizada",
  anulada: "Anulada",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  linea_credito: "Línea de crédito",
  fondo_proyecto: "Fondo de proyecto",
  caja_chica: "Caja chica",
};

const FLOW_LABELS: Record<string, string> = {
  compra_directa: "Compra directa",
  despacho_bodega: "Despacho bodega",
  traslado_proyecto: "Traslado proyecto",
  solicitud_compra: "Solicitud de compra",
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

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnlyUtc(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysBetween(start: Date | string | null | undefined, end: Date | string | null | undefined) {
  const startDate = normalizeDate(start);
  const endDate = normalizeDate(end);
  if (!startDate || !endDate) return null;
  return Math.round((dateOnlyUtc(endDate) - dateOnlyUtc(startDate)) / 86_400_000);
}

function uniqueText(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))
  );
}

function joinUnique(values: Array<string | null | undefined>, fallback = "") {
  const joined = uniqueText(values).join("; ");
  return joined || fallback;
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

function summarizeTaxes(items: DmcReportSourceItem[]) {
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
    totalBase: money(
      summary.baseIsv15 + summary.baseIsv18 + summary.baseIsv4 + summary.baseIsv0
    ),
    totalIsv: money(summary.isv15 + summary.isv18 + summary.isv4),
  };
}

function retentionLabel(retention: DmcReportSourceRetention) {
  return joinUnique([
    retention.retentionCode,
    retention.retentionErpCode,
    retention.description,
  ]);
}

function retentionText(retention: DmcReportSourceRetention) {
  return retentionLabel(retention).toLocaleUpperCase("es-HN");
}

function summarizeRetentions(retentions: DmcReportSourceRetention[]) {
  const summary = {
    retIsr1: 0,
    retIsr12_5: 0,
    retIsr25: 0,
    retIsv: 0,
    criterioRetIsr1: [] as string[],
    criterioRetIsr12_5: [] as string[],
    criterioRetIsr25: [] as string[],
    criterioRetIsv: [] as string[],
    totalRetencion: 0,
  };

  for (const retention of retentions) {
    const amount = money(retention.amount);
    const label = retentionLabel(retention);
    const text = retentionText(retention);
    const percentage = toNumber(retention.percentage);
    summary.totalRetencion += amount;

    if (text.includes("ISV")) {
      summary.retIsv += amount;
      summary.criterioRetIsv.push(label);
    } else if (isRate(percentage, 1) || text.includes("1%")) {
      summary.retIsr1 += amount;
      summary.criterioRetIsr1.push(label);
    } else if (isRate(percentage, 12.5) || text.includes("12.5%") || text.includes("12,5%")) {
      summary.retIsr12_5 += amount;
      summary.criterioRetIsr12_5.push(label);
    } else if (isRate(percentage, 25) || text.includes("25%")) {
      summary.retIsr25 += amount;
      summary.criterioRetIsr25.push(label);
    }
  }

  return {
    retIsr1: money(summary.retIsr1),
    retIsr12_5: money(summary.retIsr12_5),
    retIsr25: money(summary.retIsr25),
    retIsv: money(summary.retIsv),
    totalRetencion: money(summary.totalRetencion),
    criterioRetIsr1: joinUnique(summary.criterioRetIsr1),
    criterioRetIsr12_5: joinUnique(summary.criterioRetIsr12_5),
    criterioRetIsr25: joinUnique(summary.criterioRetIsr25),
    criterioRetIsv: joinUnique(summary.criterioRetIsv),
  };
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
    establecimiento: compact.slice(0, 3),
    puntoEmision: compact.slice(3, 6),
    tipoDocumento: compact.slice(6, 8),
    correlativo: compact.slice(8, 16),
  };
}

function formatFlow(value: string | null | undefined) {
  if (!value) return "";
  return FLOW_LABELS[value] ?? value;
}

function formatDateForObservation(value: Date | string | null | undefined) {
  const date = normalizeDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildInvoiceRow(
  invoice: DmcReportSourceInvoice,
  index: number
): DmcReportRow {
  const taxes = summarizeTaxes(invoice.items);
  const retentions = summarizeRetentions(invoice.retentions);
  const hasOceExemption = invoice.hasOceExemption === true;
  const baseIsv0 = hasOceExemption
    ? money(invoice.oceExemptAmount)
    : taxes.baseIsv0;
  const totalBase = money(
    taxes.baseIsv15 + taxes.baseIsv18 + taxes.baseIsv4 + baseIsv0
  );
  const oceObservation = hasOceExemption
    ? joinUnique([
        invoice.oceResolutionNumber
          ? `OCE resolución ${invoice.oceResolutionNumber}`
          : "OCE",
        formatDateForObservation(invoice.oceResolutionDate),
      ])
    : "";
  const documentDate = normalizeDate(invoice.documentDate ?? invoice.receiptDate ?? invoice.postingDate);
  const dueDate = normalizeDate(invoice.documentDueDate);
  const invoiceNumberParts = splitInvoiceNumber(invoice.invoiceNumber);
  const materialRequestNumbers = uniqueText(
    invoice.materialRequests.map(request => request.requestNumber)
  );
  const flowLabels = uniqueText(
    invoice.materialRequests.map(request => formatFlow(request.assignedFlow))
  );
  const itemDescription = joinUnique(
    invoice.items.map(item => item.itemName),
    invoice.invoiceDocumentNumber
  );
  const totalFactura = money(invoice.total);
  const totalRetencion = money(invoice.retentionTotal) || retentions.totalRetencion;
  const netoPagar =
    money(invoice.netPayable) || money(totalFactura - totalRetencion);

  return {
    numeroRegistro: index + 1,
    codFinanzas: "",
    nombreGrupoFinanciero: "",
    codigoSap: "",
    rtn: invoice.supplierRtn ?? "",
    razonSocial: invoice.supplierName ?? "",
    sistemaDePago: invoice.purchaseOrderPaymentMethod
      ? PAYMENT_METHOD_LABELS[invoice.purchaseOrderPaymentMethod] ?? invoice.purchaseOrderPaymentMethod
      : "",
    moneda: invoice.currency === "USD" ? "USD" : "HNL",
    tipoDeComprobante:
      getDocumentTypeLabelFromNumber(invoice.invoiceNumber) ??
      (invoice.isFiscalDocument ? "Factura" : "Documento interno"),
    fechaFactura: documentDate,
    establecimiento: invoiceNumberParts.establecimiento,
    puntoEmision: invoiceNumberParts.puntoEmision,
    tipoDocumento:
      invoiceNumberParts.tipoDocumento ||
      getDocumentTypeCodeFromNumber(invoice.invoiceNumber) ||
      "",
    correlativo: invoiceNumberParts.correlativo,
    cai: invoice.cai ?? "",
    descripcionFactura: itemDescription,
    diasCredito: daysBetween(documentDate, dueDate),
    baseIsv15: taxes.baseIsv15,
    baseIsv18: taxes.baseIsv18,
    baseIsv4: taxes.baseIsv4,
    baseIsv0,
    anticipo: null,
    noComprobanteRetencion: invoice.retentionReceiptNumber ?? "",
    fechaComprobanteRetencion: null,
    criterioRetIsr1: retentions.criterioRetIsr1,
    criterioRetIsr12_5: retentions.criterioRetIsr12_5,
    criterioRetIsr25: retentions.criterioRetIsr25,
    criterioRetIsv: retentions.criterioRetIsv,
    empresa: "",
    sucursal: joinUnique([invoice.projectCode, invoice.projectName]),
    totalBase: totalBase || money(invoice.subtotal),
    isv15: taxes.isv15,
    isv18: taxes.isv18,
    isv4: taxes.isv4,
    totalIsv: taxes.totalIsv || money(invoice.taxAmount),
    totalFactura,
    retIsr1: retentions.retIsr1,
    retIsr12_5: retentions.retIsr12_5,
    retIsr25: retentions.retIsr25,
    retIsv: retentions.retIsv,
    totalRetencion,
    netoPagar,
    fechaVencimiento: dueDate,
    tipoPago: invoice.purchaseOrderPaymentMethod
      ? PAYMENT_METHOD_LABELS[invoice.purchaseOrderPaymentMethod] ?? invoice.purchaseOrderPaymentMethod
      : "",
    statusPago: STATUS_LABELS[invoice.status] ?? invoice.status,
    lotePago: "",
    cuentaBancaria: "",
    fechaPago: null,
    referenciaDebito: "",
    refNotificacion: "",
    observacion: joinUnique([invoice.receiptNumber, oceObservation]),
    sinFondos: "",
    grupoMayor: invoice.purchaseOrderNumber ?? "",
    flujoId: materialRequestNumbers.join("; "),
    actividadFlujo: flowLabels.join("; "),
    job: materialRequestNumbers.join("; ") || invoice.purchaseOrderNumber || "",
    level1: invoice.projectCode ?? "",
    level2: invoice.projectName ?? "",
    level3: joinUnique(invoice.subProjectLabels),
    level4: "",
    diasVencimiento: null,
    noProvision: "",
    guiaDocumentos: "",
  };
}

function allocateMoney(total: number, weights: number[]) {
  if (weights.length === 0) return [];

  const roundedTotal = money(total);
  const normalizedWeights = weights.map(weight => Math.max(0, money(weight)));
  const totalWeight = normalizedWeights.reduce(
    (sum, weight) => sum + weight,
    0
  );
  let allocated = 0;

  return normalizedWeights.map((weight, index) => {
    if (index === normalizedWeights.length - 1) {
      return money(roundedTotal - allocated);
    }

    const amount =
      totalWeight > 0
        ? money((roundedTotal * weight) / totalWeight)
        : index === 0
          ? roundedTotal
          : 0;
    allocated = money(allocated + amount);
    return amount;
  });
}

function buildDetailRows(
  invoice: DmcReportSourceInvoice,
  invoiceIndex: number
): DmcReportRow[] {
  const invoiceRow = buildInvoiceRow(invoice, invoiceIndex);
  if (invoice.items.length === 0) return [invoiceRow];

  const itemTotalWeights = invoice.items.map(item => money(item.total));
  const itemSubtotalWeights = invoice.items.map(item => money(item.subtotal));
  const invoiceRetentions = summarizeRetentions(invoice.retentions);
  const invoiceTotal =
    money(invoice.total) ||
    money(itemTotalWeights.reduce((sum, total) => sum + total, 0));
  const totalRetention =
    money(invoice.retentionTotal) || invoiceRetentions.totalRetencion;
  const netPayable =
    money(invoice.netPayable) || money(invoiceTotal - totalRetention);
  const totalFacturaByItem = allocateMoney(invoiceTotal, itemTotalWeights);
  const totalRetentionByItem = allocateMoney(totalRetention, itemTotalWeights);
  const netPayableByItem = allocateMoney(netPayable, itemTotalWeights);
  const retIsr1ByItem = allocateMoney(
    invoiceRetentions.retIsr1,
    itemSubtotalWeights
  );
  const retIsr12_5ByItem = allocateMoney(
    invoiceRetentions.retIsr12_5,
    itemSubtotalWeights
  );
  const retIsr25ByItem = allocateMoney(
    invoiceRetentions.retIsr25,
    itemSubtotalWeights
  );
  const retIsvByItem = allocateMoney(
    invoiceRetentions.retIsv,
    itemSubtotalWeights
  );
  const oceBaseByItem = allocateMoney(
    invoice.hasOceExemption === true ? money(invoice.oceExemptAmount) : 0,
    itemSubtotalWeights
  );

  return invoice.items.map((item, itemIndex) => {
    const taxes = summarizeTaxes([item]);
    const baseIsv0 =
      invoice.hasOceExemption === true
        ? oceBaseByItem[itemIndex]
        : taxes.baseIsv0;
    const totalBase = money(
      taxes.baseIsv15 + taxes.baseIsv18 + taxes.baseIsv4 + baseIsv0
    );

    return {
      ...invoiceRow,
      codFinanzas: item.financialGroupCode ?? "",
      nombreGrupoFinanciero: item.financialGroupDescription ?? "",
      codigoSap: item.sapItemCode ?? "",
      descripcionFactura:
        item.articleDescription || item.itemName || invoice.invoiceDocumentNumber,
      baseIsv15: taxes.baseIsv15,
      baseIsv18: taxes.baseIsv18,
      baseIsv4: taxes.baseIsv4,
      baseIsv0,
      totalBase: totalBase || money(item.subtotal),
      isv15: taxes.isv15,
      isv18: taxes.isv18,
      isv4: taxes.isv4,
      totalIsv: taxes.totalIsv || money(item.taxAmount),
      totalFactura: totalFacturaByItem[itemIndex],
      retIsr1: retIsr1ByItem[itemIndex],
      retIsr12_5: retIsr12_5ByItem[itemIndex],
      retIsr25: retIsr25ByItem[itemIndex],
      retIsv: retIsvByItem[itemIndex],
      totalRetencion: totalRetentionByItem[itemIndex],
      netoPagar: netPayableByItem[itemIndex],
    };
  });
}

export function buildDmcReportPayload(
  invoices: DmcReportSourceInvoice[],
  params: {
    generatedAt?: Date;
    source?: string;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
    statusMode?: DmcStatusMode;
  } = {}
): DmcReportPayload {
  const rows = invoices.flatMap((invoice, index) =>
    buildDetailRows(invoice, index)
  );
  const totalsByCurrency = (["HNL", "USD"] as const)
    .map(currency => {
      const currencyRows = rows.filter(row => row.moneda === currency);
      const currencyInvoices = invoices.filter(
        invoice => (invoice.currency === "USD" ? "USD" : "HNL") === currency
      );
      return {
        currency,
        invoiceCount: currencyInvoices.length,
        totalBase: money(
          currencyRows.reduce(
            (sum, row) => sum + toNumber(row.totalBase as number),
            0
          )
        ),
        totalIsv: money(
          currencyRows.reduce(
            (sum, row) => sum + toNumber(row.totalIsv as number),
            0
          )
        ),
        totalFactura: money(
          currencyRows.reduce(
            (sum, row) => sum + toNumber(row.totalFactura as number),
            0
          )
        ),
        totalRetencion: money(
          currencyRows.reduce(
            (sum, row) => sum + toNumber(row.totalRetencion as number),
            0
          )
        ),
        netoPagar: money(
          currencyRows.reduce(
            (sum, row) => sum + toNumber(row.netoPagar as number),
            0
          )
        ),
      };
    })
    .filter(summary => summary.invoiceCount > 0);

  return {
    rows,
    summary: {
      generatedAt: params.generatedAt ?? new Date(),
      source: params.source ?? "Base actual de BuildReq",
      dateFrom: normalizeDate(params.dateFrom),
      dateTo: normalizeDate(params.dateTo),
      statusMode: params.statusMode ?? "non_void",
      invoiceCount: invoices.length,
      totalsByCurrency,
    },
  };
}
