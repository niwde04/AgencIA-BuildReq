import type { DmcReportSourceInvoice } from "./dmc-report";
import type { PurchaseOrderTaxBreakdownEntry } from "./purchase-orders";
import { roundPurchaseOrderMoney } from "./purchase-orders";

export type DmcSarStatusMode = "non_void" | "registered_only" | "all";
export type FiscalReportIssue = {
  invoiceId: number;
  invoiceNumber: string;
  field: string;
  message: string;
};

type DmcAmounts = {
  exempt: number;
  exonerated15: number;
  exonerated18: number;
  base15: number;
  base18: number;
  cost: number | null;
  expense: number | null;
  nonDeductible: number | null;
};

export type DmcSar52752Row = DmcAmounts & {
  supplierRtn: string;
  documentClass: "FA" | "OC";
  cai: string;
  fiscalDocumentNumber: string;
  otherDocumentNumber: string;
  documentDate: Date | null;
  postingDate: Date | null;
  oceNumber: string;
  oceResolutionNumber: string;
};

export type DmcSar52753Row = DmcAmounts & {
  foreignIdentification: string;
  foreignTaxIdentifier: string;
  supplierName: string;
  fyducaNumber: string;
  documentDate: Date | null;
  postingDate: Date | null;
  oceNumber: string;
  oceResolutionNumber: string;
};

export type DmcSar52754Row = DmcAmounts & {
  foreignIdentification: string;
  supplierName: string;
  duaNumber: string;
  documentDate: Date | null;
  postingDate: Date | null;
  oceNumber: string;
  oceResolutionNumber: string;
  base15OutsideCentralAmerica: number;
  base18OutsideCentralAmerica: number;
};

export type DmcSarReportPayload = {
  section52752: DmcSar52752Row[];
  section52753: DmcSar52753Row[];
  section52754: DmcSar52754Row[];
  issues: FiscalReportIssue[];
  canExport: boolean;
  summary: {
    generatedAt: Date;
    source: string;
    dateFrom: Date | null;
    dateTo: Date | null;
    statusMode: DmcSarStatusMode;
    invoiceCount: number;
    section52752Count: number;
    section52753Count: number;
    section52754Count: number;
    issueCount: number;
    totalBase: number;
    totalCost: number;
    totalExpense: number;
    totalNonDeductible: number;
  };
};

function numberValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number | null | undefined) {
  return roundPurchaseOrderMoney(numberValue(value));
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function breakdown(
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

function isRate(value: string | number | null | undefined, rate: number) {
  return Math.abs(numberValue(value) - rate) < 0.0001;
}

function taxAmounts(invoice: DmcReportSourceInvoice) {
  let exempt = 0;
  let base15 = 0;
  let base18 = 0;
  let base4 = 0;

  for (const item of invoice.items) {
    const allEntries = breakdown(item.taxBreakdown);
    const entries = allEntries.filter(
      entry => entry.taxType === "base"
    );
    if (entries.length === 0) {
      if (item.taxCode === "isv_15") base15 += money(item.subtotal);
      else if (item.taxCode === "isv_18") base18 += money(item.subtotal);
      else if (item.taxCode === "isv_4") base4 += money(item.subtotal);
      else exempt += money(item.subtotal);
      continue;
    }
    const hasBaseIsv4 = entries.some(entry =>
      isRate(entry.ratePercent, 4)
    );
    if (
      !hasBaseIsv4 &&
      allEntries.some(entry => isRate(entry.ratePercent, 4))
    ) {
      base4 += money(item.subtotal);
    }
    for (const entry of entries) {
      const base = money(entry.baseAmount ?? item.subtotal);
      if (
        entry.fiscalCategory === "gravado" &&
        isRate(entry.ratePercent, 15)
      ) {
        base15 += base;
      } else if (
        entry.fiscalCategory === "gravado" &&
        isRate(entry.ratePercent, 18)
      ) {
        base18 += base;
      } else if (
        entry.fiscalCategory === "gravado" &&
        isRate(entry.ratePercent, 4)
      ) {
        base4 += base;
      }
      else if (numberValue(entry.ratePercent) === 0) exempt += base;
    }
  }
  return {
    exempt: money(exempt),
    base15: money(base15),
    base18: money(base18),
    base4: money(base4),
  };
}

function destinationAmounts(invoice: DmcReportSourceInvoice) {
  const values = { cost: 0, expense: 0, nonDeductible: 0 };
  let hasClassification = false;
  let hasUnclassifiedAmount = false;
  for (const item of invoice.items) {
    const amount = money(item.subtotal);
    if (item.dmcDestination === "costo") {
      hasClassification = true;
      values.cost += amount;
    } else if (item.dmcDestination === "gasto") {
      hasClassification = true;
      values.expense += amount;
    } else if (item.dmcDestination === "no_deducible") {
      hasClassification = true;
      values.nonDeductible += amount;
    } else if (Math.abs(amount) > 0) {
      hasUnclassifiedAmount = true;
    }
  }
  if (!hasClassification || hasUnclassifiedAmount) {
    return {
      cost: null,
      expense: null,
      nonDeductible: null,
    };
  }
  return {
    cost: money(values.cost),
    expense: money(values.expense),
    nonDeductible: money(values.nonDeductible),
  };
}

function required(
  issues: FiscalReportIssue[],
  invoice: DmcReportSourceInvoice,
  field: string,
  value: unknown,
  message: string
) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    issues.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber:
        invoice.invoiceNumber || invoice.invoiceDocumentNumber || String(invoice.invoiceId),
      field,
      message,
    });
  }
}

function commonAmounts(invoice: DmcReportSourceInvoice): DmcAmounts {
  const taxes = taxAmounts(invoice);
  const destinations = destinationAmounts(invoice);
  return {
    exempt: invoice.hasOceExemption ? 0 : taxes.exempt,
    exonerated15: money(invoice.oceExemptAmount15),
    exonerated18: money(invoice.oceExemptAmount18),
    base15: taxes.base15,
    base18: taxes.base18,
    ...destinations,
  };
}

function validateInvoice(
  invoice: DmcReportSourceInvoice,
  issues: FiscalReportIssue[]
) {
  required(issues, invoice, "documentDate", invoice.documentDate, "Falta fecha de emisión");
  required(issues, invoice, "postingDate", invoice.postingDate, "Falta fecha contable");
  required(issues, invoice, "supplierName", invoice.supplierName, "Falta proveedor");
  if (taxAmounts(invoice).base4 > 0) {
    issues.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber || invoice.invoiceDocumentNumber,
      field: "taxBreakdown",
      message: "La plantilla DMC 527 no puede representar ISV 4%",
    });
  }
  if (invoice.hasOceExemption) {
    required(issues, invoice, "oceNumber", invoice.oceNumber, "Falta número OCE");
    required(
      issues,
      invoice,
      "oceResolutionNumber",
      invoice.oceResolutionNumber,
      "Falta resolución OCE"
    );
    if (
      invoice.oceExemptAmount15 === null ||
      invoice.oceExemptAmount15 === undefined ||
      invoice.oceExemptAmount18 === null ||
      invoice.oceExemptAmount18 === undefined
    ) {
      issues.push({
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber || invoice.invoiceDocumentNumber,
        field: "oceExemptAmount15",
        message: "El histórico OCE necesita desglose exonerado 15%/18%",
      });
    } else if (
      Math.abs(
        money(invoice.oceExemptAmount) -
          money(
            numberValue(invoice.oceExemptAmount15) +
              numberValue(invoice.oceExemptAmount18)
          )
      ) > 0.01
    ) {
      issues.push({
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber || invoice.invoiceDocumentNumber,
        field: "oceExemptAmount",
        message: "El total OCE no coincide con el desglose 15%/18%",
      });
    }
  }
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
  const section52752: DmcSar52752Row[] = [];
  const section52753: DmcSar52753Row[] = [];
  const section52754: DmcSar52754Row[] = [];
  const issues: FiscalReportIssue[] = [];

  for (const invoice of invoices) {
    validateInvoice(invoice, issues);
    const amounts = commonAmounts(invoice);
    const documentDate = dateValue(
      invoice.documentDate ?? invoice.receiptDate ?? invoice.postingDate
    );
    const postingDate = dateValue(invoice.postingDate ?? invoice.receiptDate);
    const oceNumber = invoice.hasOceExemption ? invoice.oceNumber ?? "" : "";
    const oceResolutionNumber = invoice.hasOceExemption
      ? invoice.oceResolutionNumber ?? ""
      : "";

    const isUnclassifiedForeignPurchase =
      invoice.purchaseType === "extranjera" && !invoice.dmcForeignSection;

    if (invoice.dmcForeignSection === "fyduca") {
      required(
        issues,
        invoice,
        "dmcForeignIdentification",
        invoice.dmcForeignIdentification,
        "Falta identificación extranjera"
      );
      required(
        issues,
        invoice,
        "dmcFyducaNumber",
        invoice.dmcFyducaNumber,
        "Falta número FYDUCA"
      );
      section52753.push({
        ...amounts,
        foreignIdentification: invoice.dmcForeignIdentification ?? "",
        foreignTaxIdentifier: invoice.supplierRtn ?? "",
        supplierName: invoice.supplierName ?? "",
        fyducaNumber: invoice.dmcFyducaNumber ?? "",
        documentDate,
        postingDate,
        oceNumber,
        oceResolutionNumber,
      });
    } else if (
      invoice.dmcForeignSection === "importacion" ||
      isUnclassifiedForeignPurchase
    ) {
      if (!isUnclassifiedForeignPurchase) {
        required(
          issues,
          invoice,
          "dmcForeignIdentification",
          invoice.dmcForeignIdentification,
          "Falta identificación extranjera"
        );
        required(
          issues,
          invoice,
          "dmcDuaNumber",
          invoice.dmcDuaNumber,
          "Falta número DUA"
        );
      }
      const outside = invoice.dmcImportOutsideCentralAmerica === true;
      section52754.push({
        ...amounts,
        foreignIdentification: invoice.dmcForeignIdentification ?? "",
        supplierName: invoice.supplierName ?? "",
        duaNumber: invoice.dmcDuaNumber ?? "",
        documentDate,
        postingDate,
        oceNumber,
        oceResolutionNumber,
        base15: outside ? 0 : amounts.base15,
        base18: outside ? 0 : amounts.base18,
        base15OutsideCentralAmerica: outside ? amounts.base15 : 0,
        base18OutsideCentralAmerica: outside ? amounts.base18 : 0,
      });
    } else {
      required(issues, invoice, "supplierRtn", invoice.supplierRtn, "Falta RTN del proveedor");
      const documentClass =
        invoice.isFiscalDocument !== false && invoice.cai && invoice.invoiceNumber
          ? "FA"
          : "OC";
      if (documentClass === "FA") {
        required(issues, invoice, "cai", invoice.cai, "Falta CAI");
        required(
          issues,
          invoice,
          "invoiceNumber",
          invoice.invoiceNumber,
          "Falta número fiscal"
        );
      }
      section52752.push({
        ...amounts,
        supplierRtn: invoice.supplierRtn ?? "",
        documentClass,
        cai: documentClass === "FA" ? invoice.cai ?? "" : "",
        fiscalDocumentNumber:
          documentClass === "FA" ? invoice.invoiceNumber ?? "" : "",
        otherDocumentNumber:
          documentClass === "OC"
            ? invoice.invoiceNumber || invoice.invoiceDocumentNumber
            : "",
        documentDate,
        postingDate,
        oceNumber,
        oceResolutionNumber,
      });
    }
  }

  const allRows = [...section52752, ...section52753, ...section52754];
  const sum = (key: keyof DmcAmounts) =>
    money(allRows.reduce((total, row) => total + numberValue(row[key]), 0));

  return {
    section52752,
    section52753,
    section52754,
    issues,
    canExport: issues.length === 0,
    summary: {
      generatedAt: params.generatedAt ?? new Date(),
      source: params.source ?? "Base actual de BuildReq",
      dateFrom: dateValue(params.dateFrom),
      dateTo: dateValue(params.dateTo),
      statusMode: params.statusMode ?? "non_void",
      invoiceCount: invoices.length,
      section52752Count: section52752.length,
      section52753Count: section52753.length,
      section52754Count: section52754.length,
      issueCount: issues.length,
      totalBase: money(
        sum("exempt") +
          sum("exonerated15") +
          sum("exonerated18") +
          sum("base15") +
          sum("base18")
      ),
      totalCost: sum("cost"),
      totalExpense: sum("expense"),
      totalNonDeductible: sum("nonDeductible"),
    },
  };
}
