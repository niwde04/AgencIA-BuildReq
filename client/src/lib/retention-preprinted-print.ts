import type { RetentionSnapshot } from "@shared/retention-documents";
import {
  getPurchaseCurrencySymbol,
  normalizePurchaseCurrency,
  type PurchaseCurrency,
} from "@shared/purchase-orders";
import {
  formatRetentionCalendarDate,
  getPrintableRetentionConcepts,
  getRetentionCurrencyWord,
} from "./retention-print";

// Exact preprinted HTML and measurements from Facturas at 5260a3c^.
function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapePrintHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatRetentionPrintDate(value: string | Date | null | undefined) {
  return formatRetentionCalendarDate(value);
}

function formatRetentionPrintNumber(value: string | number | null | undefined) {
  return toNumber(value).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function wordsUnderThousand(value: number): string {
  const units = [
    "",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
  ];
  const teens: Record<number, string> = {
    10: "diez",
    11: "once",
    12: "doce",
    13: "trece",
    14: "catorce",
    15: "quince",
    16: "dieciseis",
    17: "diecisiete",
    18: "dieciocho",
    19: "diecinueve",
    20: "veinte",
    21: "veintiuno",
    22: "veintidos",
    23: "veintitres",
    24: "veinticuatro",
    25: "veinticinco",
    26: "veintiseis",
    27: "veintisiete",
    28: "veintiocho",
    29: "veintinueve",
  };
  const tens = [
    "",
    "",
    "veinte",
    "treinta",
    "cuarenta",
    "cincuenta",
    "sesenta",
    "setenta",
    "ochenta",
    "noventa",
  ];
  const hundreds = [
    "",
    "ciento",
    "doscientos",
    "trescientos",
    "cuatrocientos",
    "quinientos",
    "seiscientos",
    "setecientos",
    "ochocientos",
    "novecientos",
  ];

  if (value === 0) return "";
  if (value === 100) return "cien";
  if (value < 10) return units[value];
  if (value < 30) return teens[value];
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const unit = value % 10;
    return unit ? `${tens[ten]} y ${units[unit]}` : tens[ten];
  }

  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  return rest
    ? `${hundreds[hundred]} ${wordsUnderThousand(rest)}`
    : hundreds[hundred];
}

function integerToSpanishWords(value: number): string {
  if (value === 0) return "cero";

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const rest = value % 1_000;
  const parts: string[] = [];

  if (millions > 0) {
    parts.push(
      millions === 1
        ? "un millon"
        : `${integerToSpanishWords(millions)} millones`
    );
  }
  if (thousands > 0) {
    parts.push(
      thousands === 1 ? "mil" : `${wordsUnderThousand(thousands)} mil`
    );
  }
  if (rest > 0) {
    parts.push(wordsUnderThousand(rest));
  }

  return parts.join(" ");
}

function amountToSpanishCurrency(value: number, currency: PurchaseCurrency) {
  const centsTotal = Math.max(0, Math.round(value * 100));
  const units = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  const unitLabel = getRetentionCurrencyWord(currency, units);
  return `${integerToSpanishWords(units).toUpperCase()} ${unitLabel} CON ${String(cents).padStart(2, "0")}/100`;
}

export function buildPreprintedRetentionHtml(document: {
  currency: string;
  snapshot: RetentionSnapshot;
}) {
  const s = document.snapshot;
  const originalInvoice = (s.original?.invoice ?? {}) as {
    cai?: string | null;
    documentDate?: string | Date | null;
    receiptDate?: string | Date | null;
    postingDate?: string | Date | null;
  };
  const detail = {
    invoice: {
      ...originalInvoice,
      invoiceNumber: s.invoiceNumber,
      invoiceDocumentNumber: s.invoiceDocumentNumber,
    },
    supplier: {
      name: s.supplierName,
      rtn: s.supplierRtn,
      address: s.supplierAddress,
    },
    supplierContact: {},
  };
  const retentionDrafts = s.lines;
  const selectedInvoiceCurrency = normalizePurchaseCurrency(document.currency);
  const invoice = detail.invoice;
  const supplier = (detail.supplier ?? {}) as Record<string, any>;
  const supplierContact = (detail.supplierContact ?? {}) as Record<string, any>;
  const supplierName = supplier?.name ?? "Proveedor";
  const supplierRtn =
    supplier?.rtn ??
    supplier?.taxId ??
    supplier?.rtnNumber ??
    supplier?.supplierRtn ??
    "";
  const supplierAddress =
    supplierContact?.address ??
    supplier?.address ??
    supplier?.direccion ??
    supplier?.location ??
    "";
  const documentNumber =
    invoice.invoiceNumber || invoice.invoiceDocumentNumber || "";
  const documentDate = formatRetentionPrintDate(
    invoice.documentDate ?? invoice.receiptDate ?? invoice.postingDate
  );
  const { printableConcepts } = getPrintableRetentionConcepts(retentionDrafts);

  const rowsHtml = printableConcepts
    .map((retentionConcept, index) => {
      const top = 52 + index * 7.7;
      const rate = toNumber(retentionConcept.percentage).toLocaleString(
        "es-HN",
        {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4,
        }
      );
      return `
          <div class="cell row-date" style="top:${top}mm">${escapePrintHtml(documentDate)}</div>
          <div class="cell row-desc" style="top:${top}mm">${escapePrintHtml(retentionConcept.description || retentionConcept.retentionCode || "Retención")}</div>
          <div class="cell row-type" style="top:${top}mm">Factura</div>
          <div class="cell row-doc" style="top:${top}mm">${escapePrintHtml(documentNumber)}</div>
          <div class="cell row-base" style="top:${top}mm">${formatRetentionPrintNumber(retentionConcept.baseAmount)}</div>
          <div class="cell row-rate" style="top:${top}mm">${escapePrintHtml(rate)}%</div>
          <div class="cell row-amount" style="top:${top}mm">${formatRetentionPrintNumber(retentionConcept.amount)}</div>
        `;
    })
    .join("");

  const totalRetained = printableConcepts.reduce(
    (sum, retentionConcept) => sum + retentionConcept.amount,
    0
  );
  const amountWords = amountToSpanishCurrency(
    totalRetained,
    selectedInvoiceCurrency
  );
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>&#8203;</title>
    <style>
      @page {
        size: letter;
        margin: 0 !important;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        width: 216mm;
        height: 279mm;
      }
      body {
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
        background: white;
      }
      .page {
        position: relative;
        width: 216mm;
        height: 279mm;
        margin: 0 auto;
        background: white;
      }
      .field,
      .cell {
        position: absolute;
        overflow: hidden;
        font-size: 10pt;
        line-height: 1.1;
        white-space: nowrap;
      }
      .multiline {
        white-space: normal;
        line-height: 1.12;
      }
      .right {
        text-align: right;
      }
      .center {
        text-align: center;
      }
      .supplier-name {
        left: 19mm;
        top: 16.5mm;
        width: 126mm;
        font-weight: 600;
      }
      .supplier-rtn {
        left: 158mm;
        top: 14.5mm;
        width: 47mm;
      }
      .print-date {
        left: 170mm;
        top: 4.8mm;
        width: 32mm;
      }
      .invoice-cai {
        left: 56mm;
        top: 23.3mm;
        width: 143mm;
      }
      .supplier-address {
        left: 25mm;
        top: 30mm;
        width: 174mm;
      }
      .row-date {
        left: 5mm;
        width: 19mm;
        text-align: center;
        font-size: 8.4pt;
      }
      .row-desc {
        left: 27mm;
        width: 32mm;
        white-space: normal;
        font-size: 8.2pt;
      }
      .row-type {
        left: 61mm;
        width: 24mm;
        text-align: center;
        font-size: 8.3pt;
      }
      .row-doc {
        left: 87mm;
        width: 39mm;
        text-align: center;
        font-size: 8.2pt;
      }
      .row-base {
        left: 128mm;
        width: 24mm;
        text-align: right;
        font-size: 8.4pt;
      }
      .row-rate {
        left: 155mm;
        width: 17mm;
        text-align: center;
        font-size: 8.4pt;
      }
      .row-amount {
        left: 174mm;
        width: 28mm;
        text-align: right;
        font-size: 8.4pt;
        font-weight: 600;
      }
      .total-retained {
        left: 171mm;
        top: 102mm;
        width: 28mm;
        font-size: 9.4pt;
        font-weight: 700;
      }
      .amount-words {
        left: 35mm;
        top: 109mm;
        width: 98mm;
        font-size: 8.8pt;
        line-height: 1.18;
        font-weight: 600;
      }
      @media screen {
        .page {
          margin: 0 auto;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
        }
      }
      @media print {
        body {
          background: white;
        }
        .page {
          margin: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="field print-date">${escapePrintHtml(documentDate)}</div>
      <div class="field supplier-name">${escapePrintHtml(supplierName)}</div>
      <div class="field supplier-rtn">${escapePrintHtml(supplierRtn)}</div>
      <div class="field invoice-cai">${escapePrintHtml(invoice.cai || "")}</div>
      <div class="field supplier-address multiline">${escapePrintHtml(supplierAddress)}</div>
      ${rowsHtml}
      <div class="field total-retained right">${escapePrintHtml(
        getPurchaseCurrencySymbol(selectedInvoiceCurrency)
      )} ${formatRetentionPrintNumber(totalRetained)}</div>
      <div class="field amount-words multiline">${escapePrintHtml(amountWords)}</div>
    </div>
    <script>
      window.addEventListener("load", () => {
        window.focus();
        setTimeout(() => window.print(), 250);
      });
    </script>
  </body>
</html>`;

  return html;
}
