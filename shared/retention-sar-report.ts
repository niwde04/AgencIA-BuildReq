import type { DmcReportSourceInvoice } from "./dmc-report";
import type { FiscalReportIssue } from "./dmc-sar-report";
import type { PurchaseOrderTaxBreakdownEntry } from "./purchase-orders";
import { roundPurchaseOrderMoney } from "./purchase-orders";

export type RetentionSarType = "RT01" | "RT125" | "RT15";
export type RetentionSarRow = {
  invoiceId: number;
  supplierRtn: string;
  documentClass: "CF" | "OC";
  invoiceCai: string;
  fiscalDocumentNumber: string;
  otherDocumentNumber: string;
  invoiceDate: Date | null;
  retentionDocumentDate: Date | null;
  justificationNumber: string;
  f01Code: string;
  retentionCai: string;
  retentionDocumentNumber: string;
  stateInstitutionCode: string;
  retainedBase: number;
  retainedBase15: number;
  retainedBase18: number;
};

export type RetentionSarPayload = {
  type: RetentionSarType;
  rows: RetentionSarRow[];
  issues: FiscalReportIssue[];
  canExport: boolean;
  summary: {
    generatedAt: Date;
    source: string;
    dateFrom: Date | null;
    dateTo: Date | null;
    statusMode: "non_void" | "registered_only" | "all";
    invoiceCount: number;
    rowCount: number;
    issueCount: number;
    retainedBase: number;
    retentionAmount: number;
  };
};

function valueNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number | null | undefined) {
  return roundPurchaseOrderMoney(valueNumber(value));
}

function cents(value: string | number | null | undefined) {
  return Math.round((valueNumber(value) + Number.EPSILON) * 100) / 100;
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsedBreakdown(
  value: PurchaseOrderTaxBreakdownEntry[] | string | null | undefined
) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? (parsed as PurchaseOrderTaxBreakdownEntry[])
      : [];
  } catch {
    return [];
  }
}

function taxableBases(
  items: DmcReportSourceInvoice["items"]
): { base15: number; base18: number } {
  let base15 = 0;
  let base18 = 0;
  for (const item of items) {
    const entries = parsedBreakdown(item.taxBreakdown).filter(
      entry => entry.taxType === "base"
    );
    if (entries.length === 0) {
      if (item.taxCode === "isv_15") base15 += money(item.subtotal);
      if (item.taxCode === "isv_18") base18 += money(item.subtotal);
      continue;
    }
    for (const entry of entries) {
      const rate = valueNumber(entry.ratePercent);
      if (Math.abs(rate - 15) < 0.0001) {
        base15 += money(entry.baseAmount ?? item.subtotal);
      } else if (Math.abs(rate - 18) < 0.0001) {
        base18 += money(entry.baseAmount ?? item.subtotal);
      }
    }
  }
  return { base15: money(base15), base18: money(base18) };
}

function addIssue(
  issues: FiscalReportIssue[],
  invoice: DmcReportSourceInvoice,
  field: string,
  message: string
) {
  issues.push({
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber || invoice.invoiceDocumentNumber,
    field,
    message,
  });
}

function validateRequired(
  invoice: DmcReportSourceInvoice,
  issues: FiscalReportIssue[]
) {
  if (!invoice.supplierRtn?.trim()) addIssue(issues, invoice, "supplierRtn", "Falta RTN");
  if (!dateValue(invoice.documentDate ?? invoice.postingDate ?? invoice.receiptDate)) {
    addIssue(issues, invoice, "documentDate", "Falta fecha de emisión");
  }
  if (!dateValue(invoice.retentionDocumentDate)) {
    addIssue(
      issues,
      invoice,
      "retentionDocumentDate",
      "Falta fecha del comprobante de retención"
    );
  }
  if (!invoice.retentionReceiptNumber?.trim()) {
    addIssue(
      issues,
      invoice,
      "retentionReceiptNumber",
      "Falta número del comprobante de retención"
    );
  }
  if (!invoice.retentionCai?.trim()) {
    addIssue(issues, invoice, "retentionCai", "Falta CAI de retención");
  }
  if (invoice.isFiscalDocument !== false) {
    if (!invoice.cai?.trim()) addIssue(issues, invoice, "cai", "Falta CAI de factura");
    if (!invoice.invoiceNumber?.trim()) {
      addIssue(issues, invoice, "invoiceNumber", "Falta número fiscal");
    }
  }
}

function splitRt15Base(
  invoice: DmcReportSourceInvoice,
  base: number,
  retentionItemIds: number[]
) {
  const sourceItems =
    retentionItemIds.length > 0
      ? invoice.items.filter(item => retentionItemIds.includes(item.id))
      : invoice.items;
  const taxes = taxableBases(sourceItems);
  const totalTaxable = money(taxes.base15 + taxes.base18);
  if (totalTaxable <= 0) return { base15: 0, base18: 0 };
  const roundedBase = cents(base);
  const base15 = cents((roundedBase * taxes.base15) / totalTaxable);
  return {
    base15,
    base18: cents(roundedBase - base15),
  };
}

export function buildRetentionSarPayload(
  invoices: DmcReportSourceInvoice[],
  type: RetentionSarType,
  params: {
    generatedAt?: Date;
    source?: string;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
    statusMode?: "non_void" | "registered_only" | "all";
  } = {}
): RetentionSarPayload {
  const rows: RetentionSarRow[] = [];
  const issues: FiscalReportIssue[] = [];
  let retentionAmount = 0;

  for (const invoice of invoices) {
    const matching = invoice.retentions.filter(
      retention => retention.retentionCode === type
    );
    if (matching.length === 0) continue;
    validateRequired(invoice, issues);
    if (type === "RT125" && invoice.isFiscalDocument === false) {
      addIssue(
        issues,
        invoice,
        "isFiscalDocument",
        "El formato 112 requiere comprobante fiscal con CAI"
      );
    }

    const retainedBase = cents(
      matching.reduce(
        (sum, retention) => sum + valueNumber(retention.baseAmount),
        0
      )
    );
    retentionAmount += matching.reduce(
      (sum, retention) => sum + valueNumber(retention.amount),
      0
    );
    if (retainedBase <= 0) {
      addIssue(issues, invoice, "baseAmount", "La base retenida debe ser mayor que cero");
    }

    const itemIds = matching
      .map(retention => retention.invoiceItemId)
      .filter((id): id is number => typeof id === "number");
    const split =
      type === "RT15"
        ? splitRt15Base(invoice, retainedBase, itemIds)
        : { base15: 0, base18: 0 };
    if (type === "RT15" && retainedBase > 0 && split.base15 + split.base18 === 0) {
      addIssue(
        issues,
        invoice,
        "taxBreakdown",
        "No se puede distribuir RT15 sin bases ISV 15%/18%"
      );
    }

    const fiscal = invoice.isFiscalDocument !== false;
    rows.push({
      invoiceId: invoice.invoiceId,
      supplierRtn: invoice.supplierRtn ?? "",
      documentClass: fiscal ? "CF" : "OC",
      invoiceCai: fiscal ? invoice.cai ?? "" : "",
      fiscalDocumentNumber: fiscal ? invoice.invoiceNumber ?? "" : "",
      otherDocumentNumber: fiscal
        ? ""
        : invoice.invoiceNumber || invoice.invoiceDocumentNumber,
      invoiceDate: dateValue(
        invoice.documentDate ?? invoice.postingDate ?? invoice.receiptDate
      ),
      retentionDocumentDate: dateValue(invoice.retentionDocumentDate),
      justificationNumber: "",
      f01Code: "",
      retentionCai: invoice.retentionCai ?? "",
      retentionDocumentNumber: invoice.retentionReceiptNumber ?? "",
      stateInstitutionCode: "",
      retainedBase,
      retainedBase15: split.base15,
      retainedBase18: split.base18,
    });
  }

  return {
    type,
    rows,
    issues,
    canExport: issues.length === 0,
    summary: {
      generatedAt: params.generatedAt ?? new Date(),
      source: params.source ?? "Base actual de BuildReq",
      dateFrom: dateValue(params.dateFrom),
      dateTo: dateValue(params.dateTo),
      statusMode: params.statusMode ?? "non_void",
      invoiceCount: rows.length,
      rowCount: rows.length,
      issueCount: issues.length,
      retainedBase: money(
        rows.reduce((sum, row) => sum + row.retainedBase, 0)
      ),
      retentionAmount: money(retentionAmount),
    },
  };
}
