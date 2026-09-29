import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { INVOICE_ACCOUNTING_STATUS_LABELS } from "@shared/invoice-accounting";
import type { ExcelColumn, ExcelWorksheet } from "./excel-export";

type AccountingPage =
  inferRouterOutputs<AppRouter>["treasury"]["invoiceAccountingQueue"];
type AccountingRow = AccountingPage["items"][number];
const EXPORT_PAGE_SIZE = 50;
const MAX_EXPORT_ROWS = 10_000;

export async function collectInvoiceAccountingExport(
  fetchPage: (page: number, pageSize: number) => Promise<AccountingPage>,
  onProgress?: (loaded: number, total: number) => void
) {
  const rows: AccountingRow[] = [];
  const seen = new Set<number>();
  let total: number | undefined;
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await fetchPage(page, EXPORT_PAGE_SIZE);
    if (result.total > MAX_EXPORT_ROWS) {
      throw new Error(
        "Hay más de 10,000 facturas. Filtra por fechas, proyecto o moneda para exportarlas."
      );
    }
    total ??= result.total;
    if (
      result.total !== total ||
      result.page !== page ||
      result.items.some(row => seen.has(row.id))
    ) {
      throw new Error(
        "Las facturas cambiaron durante la exportación. Intenta descargar el Excel nuevamente."
      );
    }
    totalPages = Math.max(1, Math.ceil(total / EXPORT_PAGE_SIZE));
    for (const row of result.items) {
      seen.add(row.id);
      rows.push(row);
    }
    onProgress?.(rows.length, total);
  }
  if (rows.length !== total || seen.size !== rows.length) {
    throw new Error(
      "No se pudieron cargar todas las facturas. Intenta descargar el Excel nuevamente."
    );
  }
  return rows;
}

function documentDate(value: AccountingRow["documentDate"]) {
  if (!value) return "";
  const [year, month, day] = (
    value instanceof Date ? value.toISOString() : String(value)
  )
    .slice(0, 10)
    .split("-");
  return day + "/" + month + "/" + year;
}
const amount = (
  header: string,
  value: (row: AccountingRow) => number
): ExcelColumn<AccountingRow> => ({
  header,
  value,
  width: 21,
  numFmt: "#,##0.00",
});

type InvoiceTax = AccountingRow["taxes"][number];

function taxHeader(tax: InvoiceTax) {
  const label = tax.label.trim() || tax.code;
  const includesRate = Array.from(
    label.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)
  ).some(match => Number(match[1].replace(",", ".")) === tax.ratePercent);
  return tax.ratePercent === null || includesRate
    ? label
    : label + " " + tax.ratePercent + "%";
}

function buildTaxColumns(rows: AccountingRow[], reservedHeaders: string[]) {
  const taxes = new Map<string, InvoiceTax>();
  const totals = new Map<AccountingRow, Map<string, number>>();
  for (const row of rows) {
    const amounts = new Map<string, number>();
    for (const tax of row.taxes) {
      // Use the historical code and rate, never the current tax catalog.
      const key = JSON.stringify([
        tax.code,
        tax.ratePercent,
        tax.code === "invoice-adjustment" ? tax.label : null,
      ]);
      if (!taxes.has(key)) taxes.set(key, tax);
      amounts.set(key, (amounts.get(key) ?? 0) + tax.amount);
    }
    totals.set(row, amounts);
  }
  const headerCounts = new Map<string, number>();
  for (const tax of Array.from(taxes.values())) {
    const header = taxHeader(tax);
    headerCounts.set(header, (headerCounts.get(header) ?? 0) + 1);
  }
  const usedHeaders = new Set(reservedHeaders);
  return Array.from(taxes, ([key, tax]) => {
    const label = taxHeader(tax);
    const base =
      usedHeaders.has(label) || headerCounts.get(label)! > 1
        ? label + " (" + tax.code + ")"
        : label;
    let header = base;
    for (let suffix = 2; usedHeaders.has(header); suffix += 1) {
      header = base + " (" + suffix + ")";
    }
    usedHeaders.add(header);
    return {
      ...amount(header, row => totals.get(row)?.get(key) ?? 0),
      width: Math.min(Math.max(header.length + 2, 21), 48),
    };
  });
}

export function buildInvoiceAccountingWorksheets(
  rows: AccountingRow[]
): ExcelWorksheet[] {
  const columns: ExcelColumn<AccountingRow>[] = [
    { header: "Documento", value: row => row.document, width: 23 },
    { header: "Proyecto", value: row => row.project, width: 36 },
    { header: "Proveedor", value: row => row.supplier, width: 40 },
    { header: "RTN", value: row => row.rtn, width: 20 },
    { header: "Nro. Factura", value: row => row.number, width: 25 },
    {
      header: "Fecha del Documento",
      value: row => documentDate(row.documentDate),
      width: 22,
    },
    { header: "Moneda", value: row => row.currency, width: 10 },
    amount("Subtotal", row => row.subtotal),
    amount("ISV", row => row.tax),
    amount("Otros Cargos", row => row.otherCharges),
    amount("Total Factura", row => row.total),
    amount("Retención 1%", row => row.retentions.one),
    amount("Retención 10%", row => row.retentions.ten),
    amount("Honorarios y Servicios (12.5%)", row => row.retentions.services),
    amount("Retención 15%", row => row.retentions.fifteen),
    amount("Retención 25%", row => row.retentions.twentyFive),
    amount("Otras Retenciones", row => row.retentions.other),
    amount("Descuento por documento", row => row.discount),
    amount("Neto a Pagar", row => row.net),
    amount("Anticipo Aplicado", row => row.appliedAdvance),
    amount("Saldo Pendiente", row => row.balance),
    {
      header: "Estado de pago",
      value: row =>
        row.balance <= 0
          ? "Pagado"
          : row.paid + row.appliedAdvance > 0
            ? "Parcial"
            : "Pendiente",
    },
    {
      header: "Estatus",
      value: row => INVOICE_ACCOUNTING_STATUS_LABELS[row.status] ?? row.status,
      width: 30,
    },
    {
      header: "Motivo de rechazo",
      value: row => row.rejectionComment,
      width: 40,
    },
  ];
  const taxColumns = buildTaxColumns(
    rows,
    columns.map(column => column.header)
  );
  columns.splice(
    columns.findIndex(column => column.header === "ISV") + 1,
    0,
    ...taxColumns
  );
  return [{ sheetName: "Facturas por contabilizar", columns, rows }];
}
