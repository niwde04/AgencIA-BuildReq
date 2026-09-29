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
  const taxes = rows.flatMap(row =>
    row.taxes.map(tax => ({
      document: row.document,
      number: row.number,
      currency: row.currency,
      ...tax,
    }))
  );
  return [
    { sheetName: "Facturas por contabilizar", columns, rows },
    {
      sheetName: "Desglose ISV",
      rows: taxes,
      columns: [
        { header: "Documento", value: row => row.document, width: 23 },
        { header: "Nro. Factura", value: row => row.number, width: 25 },
        { header: "Moneda", value: row => row.currency, width: 10 },
        { header: "Código impuesto", value: row => row.code, width: 20 },
        { header: "Descripción", value: row => row.label, width: 40 },
        {
          header: "Tasa %",
          value: row => row.ratePercent,
          numFmt: "0.00",
          width: 12,
        },
        {
          header: "Importe",
          value: row => row.amount,
          numFmt: "#,##0.00",
          width: 21,
        },
      ],
    },
  ];
}
