type TreasuryPaymentReportCurrency = "HNL" | "USD";

type TreasuryPaymentReportRetention = {
  retentionCode?: string | null;
  retentionErpCode?: string | null;
  description?: string | null;
  percentage?: string | number | null;
  amount?: string | number | null;
};

type TreasuryPaymentReportInvoice = {
  invoiceNumber?: string | null;
  invoiceDocumentNumber: string;
  documentDate?: string | Date | null;
  total?: string | number | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  items?: Array<{
    itemName?: string | null;
    articleDescription?: string | null;
    financialGroupCode?: string | null;
  }>;
  retentions?: TreasuryPaymentReportRetention[];
};

type TreasuryPaymentReportItem = {
  supplierCode?: string | null;
  supplierName: string;
  invoiceDocumentNumber: string;
  invoiceNumber?: string | null;
  previousPaidAmount?: string | number | null;
  bankPaidAmount?: string | number | null;
  reportAmount?: string | number | null;
  bankPaidDate?: string | Date | null;
  bankReference?: string | null;
};

export type TreasuryPaymentReportPayload = {
  generatedAt: string | Date;
  batch: {
    batchNumber: string;
    currency: TreasuryPaymentReportCurrency;
    requestedPaymentDate: string | Date;
    paymentStatusLabel?: string | null;
  };
  project: {
    code: string;
    name: string;
  };
  signatures: {
    preparedBy?: string | null;
    approvedBy?: string | null;
    authorizedBy?: string | null;
  };
  lines: Array<{
    paymentItem: TreasuryPaymentReportItem;
    invoice: TreasuryPaymentReportInvoice;
  }>;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatNumber(value: number) {
  return roundMoney(value).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value: number, currency: TreasuryPaymentReportCurrency) {
  const symbol = currency === "USD" ? "US$" : "L";
  return `${symbol} ${formatNumber(value)}`;
}

function dateParts(value: string | Date | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function formatDate(value: string | Date | null | undefined) {
  const parts = dateParts(value);
  if (!parts) return "-";
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
}

function formatLongDate(value: string | Date | null | undefined) {
  const parts = dateParts(value);
  if (!parts) return "-";
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  return `${String(parts.day).padStart(2, "0")} ${months[parts.month - 1]} ${parts.year}`;
}

function joinUnique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map(value => value?.trim()).filter(Boolean) as string[])
  ).join(" / ");
}

function retentionBreakdown(retentions: TreasuryPaymentReportRetention[] = []) {
  let retIsv = 0;
  let retIsr1 = 0;
  let otherRetentions = 0;

  for (const retention of retentions) {
    const amount = toNumber(retention.amount);
    const text = joinUnique([
      retention.retentionCode,
      retention.retentionErpCode,
      retention.description,
    ]).toLocaleUpperCase("es-HN");
    const percentage = toNumber(retention.percentage);
    if (text.includes("ISV")) {
      retIsv += amount;
    } else if (Math.abs(percentage - 1) < 0.0001 || text.includes("1%")) {
      retIsr1 += amount;
    } else {
      otherRetentions += amount;
    }
  }

  return {
    retIsv: roundMoney(retIsv),
    retIsr1: roundMoney(retIsr1),
    otherRetentions: roundMoney(otherRetentions),
  };
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
  const special: Record<number, string> = {
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
  if (value < 30) return special[value];
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
  if (rest > 0) parts.push(wordsUnderThousand(rest));
  return parts.join(" ");
}

function amountInWords(
  value: number,
  currency: TreasuryPaymentReportCurrency
) {
  const centsTotal = Math.max(0, Math.round(value * 100));
  const units = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  const currencyName =
    currency === "USD"
      ? units === 1
        ? "Dolar"
        : "Dolares"
      : units === 1
        ? "Lempira"
        : "Lempiras";
  return `${integerToSpanishWords(units)} ${currencyName} ${String(cents).padStart(2, "0")}/100`;
}

type ReportAmounts = {
  totalInvoice: number;
  advances: number;
  retIsv: number;
  retIsr1: number;
  otherRetentions: number;
  netPaid: number;
};

function emptyAmounts(): ReportAmounts {
  return {
    totalInvoice: 0,
    advances: 0,
    retIsv: 0,
    retIsr1: 0,
    otherRetentions: 0,
    netPaid: 0,
  };
}

function addAmounts(target: ReportAmounts, source: ReportAmounts) {
  target.totalInvoice += source.totalInvoice;
  target.advances += source.advances;
  target.retIsv += source.retIsv;
  target.retIsr1 += source.retIsr1;
  target.otherRetentions += source.otherRetentions;
  target.netPaid += source.netPaid;
}

function amountCells(
  amounts: ReportAmounts,
  currency: TreasuryPaymentReportCurrency
) {
  return `
    <td class="money">${escapeHtml(formatMoney(amounts.totalInvoice, currency))}</td>
    <td class="money">${escapeHtml(formatMoney(amounts.advances, currency))}</td>
    <td class="money">${escapeHtml(formatMoney(amounts.retIsv, currency))}</td>
    <td class="money">${escapeHtml(formatMoney(amounts.retIsr1, currency))}</td>
    <td class="money">${escapeHtml(formatMoney(amounts.otherRetentions, currency))}</td>
    <td class="money">${escapeHtml(formatMoney(amounts.netPaid, currency))}</td>
  `;
}

export function buildTreasuryPaymentReportHtml(
  payload: TreasuryPaymentReportPayload
) {
  const currency = payload.batch.currency;
  const groups = new Map<
    string,
    {
      supplierName: string;
      supplierCode: string;
      rows: string[];
      totals: ReportAmounts;
    }
  >();
  const generalTotals = emptyAmounts();

  for (const line of payload.lines) {
    const supplierName =
      line.invoice.supplierName ||
      line.paymentItem.supplierName ||
      "Proveedor sin nombre";
    const supplierCode =
      line.invoice.supplierCode || line.paymentItem.supplierCode || "";
    const groupKey = `${supplierCode}:${supplierName}`;
    const group = groups.get(groupKey) ?? {
      supplierName,
      supplierCode,
      rows: [],
      totals: emptyAmounts(),
    };
    groups.set(groupKey, group);

    const retention = retentionBreakdown(line.invoice.retentions);
    const amounts: ReportAmounts = {
      totalInvoice: roundMoney(toNumber(line.invoice.total)),
      advances: roundMoney(toNumber(line.paymentItem.previousPaidAmount)),
      retIsv: retention.retIsv,
      retIsr1: retention.retIsr1,
      otherRetentions: retention.otherRetentions,
      netPaid: roundMoney(
        toNumber(
          line.paymentItem.reportAmount ??
            line.paymentItem.bankPaidAmount
        )
      ),
    };
    addAmounts(group.totals, amounts);
    addAmounts(generalTotals, amounts);

    const financialCodes =
      joinUnique(
        (line.invoice.items ?? []).map(item => item.financialGroupCode)
      ) || "-";
    const descriptions =
      joinUnique(
        (line.invoice.items ?? []).map(
          item => item.itemName || item.articleDescription
        )
      ) || "-";
    const invoiceNumber =
      line.invoice.invoiceNumber ||
      line.paymentItem.invoiceNumber ||
      line.invoice.invoiceDocumentNumber ||
      line.paymentItem.invoiceDocumentNumber;

    group.rows.push(`
      <tr class="detail-row">
        <td>
          <div class="supplier-name">${escapeHtml(supplierName)}</div>
          ${supplierCode ? `<div class="muted">${escapeHtml(supplierCode)}</div>` : ""}
        </td>
        <td>${escapeHtml(invoiceNumber)}</td>
        <td>${escapeHtml(formatDate(line.invoice.documentDate))}</td>
        <td>${escapeHtml(financialCodes)}</td>
        <td class="description">${escapeHtml(descriptions)}</td>
        ${amountCells(amounts, currency)}
      </tr>
    `);
  }

  const bodyRows = Array.from(groups.values())
    .map(
      group => `
        ${group.rows.join("")}
        <tr class="supplier-total">
          <td colspan="5">Total ${escapeHtml(group.supplierName)}</td>
          ${amountCells(group.totals, currency)}
        </tr>
      `
    )
    .join("");
  const firstPaymentDate =
    payload.lines.find(line => line.paymentItem.bankPaidDate)?.paymentItem
      .bankPaidDate ?? payload.generatedAt;
  const bankReferences =
    joinUnique(payload.lines.map(line => line.paymentItem.bankReference)) || "-";
  const currencyLabel = currency === "USD" ? "Dolares" : "Lempiras";
  const signatureName = (value: string | null | undefined) =>
    escapeHtml(value?.trim() || "Sin registrar");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(payload.batch.batchNumber)} - Detalle de pago</title>
    <style>
      @page { size: letter landscape; margin: 9mm 7mm 12mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; color: #111; font-family: Arial, Helvetica, sans-serif; }
      body { font-size: 7.5px; }
      .report { width: 100%; }
      .report-header { position: relative; display: flex; min-height: 54px; justify-content: center; padding: 2px 105px 0; }
      .logo { position: absolute; top: 0; left: 0; width: 82px; height: auto; }
      .heading { text-align: center; }
      .company { text-align: center; font-size: 10px; font-weight: 700; }
      .title { margin-top: 2px; text-align: center; font-size: 9px; font-weight: 700; text-transform: uppercase; text-decoration: underline; }
      .meta { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px; margin-top: 8px; border-bottom: 0.35pt solid #111; padding-bottom: 5px; }
      .meta-line { display: grid; grid-template-columns: auto 1fr; gap: 6px; border-bottom: 0.35pt solid #111; padding: 2px 0; }
      .meta-label { font-weight: 700; }
      .location { margin: 8px 0 5px; text-align: right; }
      .values-label { margin: 0 0 3px; text-align: center; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      th, td { border-bottom: 0.35pt solid #111; padding: 4px 3px; vertical-align: top; }
      th { border-top: 0.35pt solid #111; border-bottom: 0.35pt solid #111; font-size: 6.8px; text-align: center; }
      td { font-size: 6.8px; }
      .money { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .description { line-height: 1.35; }
      .supplier-name { font-weight: 600; }
      .muted { margin-top: 1px; color: #4b5563; font-size: 6.2px; }
      .supplier-total td { border-top: 0.35pt solid #111; font-weight: 700; }
      .general-total td { border-top: 0.6pt solid #111; border-bottom: 0.6pt solid #111; font-weight: 700; }
      .amount-words { margin-top: 6px; font-size: 7px; }
      .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 120px; margin: 42px auto 0; width: 65%; break-inside: avoid; page-break-inside: avoid; }
      .signature { border-top: 0.45pt solid #111; padding-top: 4px; text-align: center; font-size: 8px; }
      .signature-name { min-height: 10px; font-weight: 700; text-transform: uppercase; }
      .signature-role { margin-top: 2px; }
      .footer { display: flex; justify-content: space-between; margin-top: 18px; color: #4b5563; font-size: 6px; }
      col.reason { width: 14%; }
      col.invoice { width: 7%; }
      col.date { width: 6%; }
      col.code { width: 10%; }
      col.description { width: 24%; }
      col.amount { width: 6.5%; }
    </style>
  </head>
  <body>
    <main class="report">
      <header class="report-header">
        <img class="logo" src="/logo_heh.png" alt="Hidalgo e Hidalgo Constructores" />
        <div class="heading">
          <div class="company">HIDALGO e HIDALGO HONDURAS SA DE CV</div>
          <div class="title">DETALLE PAGO A PROVEEDORES OFICINA CENTRAL</div>
        </div>
      </header>

      <section class="meta">
        <div class="meta-line"><span class="meta-label">Estado del pago</span><span>${escapeHtml(payload.batch.paymentStatusLabel || "REGISTRADO")}</span></div>
        <div class="meta-line"><span class="meta-label">Lote</span><span>${escapeHtml(payload.batch.batchNumber)}</span></div>
        <div class="meta-line"><span class="meta-label">Referencia bancaria</span><span>${escapeHtml(bankReferences)}</span></div>
      </section>
      <div class="location">Oficina Central, Tegucigalpa, ${escapeHtml(formatLongDate(firstPaymentDate))}</div>
      <div class="values-label">Valores en ${escapeHtml(currencyLabel)}</div>

      <table>
        <colgroup>
          <col class="reason" />
          <col class="invoice" />
          <col class="date" />
          <col class="code" />
          <col class="description" />
          <col class="amount" />
          <col class="amount" />
          <col class="amount" />
          <col class="amount" />
          <col class="amount" />
          <col class="amount" />
        </colgroup>
        <thead>
          <tr>
            <th>Razón Social</th>
            <th>No. Factura</th>
            <th>F. emisión</th>
            <th>Cód. Finanzas</th>
            <th>Descripción Compra</th>
            <th>Total Factura</th>
            <th>Anticipos</th>
            <th>Ret. ISV</th>
            <th>Ret. ISR 1%</th>
            <th>Otras ret.</th>
            <th>Neto pagar</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="general-total">
            <td colspan="5">Total general</td>
            ${amountCells(generalTotals, currency)}
          </tr>
        </tbody>
      </table>

      <div class="amount-words"><strong>Son:</strong> ${escapeHtml(amountInWords(generalTotals.netPaid, currency))}.</div>
      <section class="signatures">
        <div class="signature">
          <div class="signature-name">${signatureName(payload.signatures.preparedBy)}</div>
          <div class="signature-role">Elaborado por.</div>
        </div>
        <div class="signature">
          <div class="signature-name">${signatureName(payload.signatures.authorizedBy)}</div>
          <div class="signature-role">Autorizado por.</div>
        </div>
      </section>
    </main>
    <div class="footer"><span>${escapeHtml(payload.project.code)} - ${escapeHtml(payload.project.name)}</span><span>${escapeHtml(payload.batch.batchNumber)}</span></div>
  </body>
</html>`;
}
