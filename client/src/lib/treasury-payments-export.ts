import type { ExcelColumn, ExcelWorksheet } from "./excel-export";
import {
  TREASURY_PAYMENTS_HEADERS,
  type TreasuryPaymentsReportRow,
} from "@shared/treasury-payments-report";

function toExcelDate(value: Date | string | null) {
  if (!value) return undefined;
  const dateKey =
    typeof value === "string"
      ? value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
      : value.toISOString().slice(0, 10);
  if (!dateKey) return undefined;
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

export const TREASURY_PAYMENTS_EXPORT_COLUMNS: ExcelColumn<TreasuryPaymentsReportRow>[] =
  [
    {
      header: TREASURY_PAYMENTS_HEADERS[0],
      value: row => row.batchNumber,
      width: 22,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[1],
      value: row => row.bankReference,
      width: 24,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[2],
      value: row => toExcelDate(row.invoiceDate),
      width: 22,
      numFmt: "dd/mm/yyyy",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[3],
      value: row => row.invoiceNumber,
      width: 24,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[4],
      value: row => row.supplierName,
      width: 42,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[5],
      value: row => row.detailType,
      width: 18,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[6],
      value: row => row.itemCode,
      width: 18,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[7],
      value: row => row.description,
      width: 54,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[8],
      value: row => row.quantity,
      width: 14,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[9],
      value: row => row.unit,
      width: 14,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[10],
      value: row => row.unitCost,
      width: 18,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[11],
      value: row => row.itemSubtotal,
      width: 18,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[12],
      value: row => row.itemTax,
      width: 16,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[13],
      value: row => row.itemTotal,
      width: 22,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[14],
      value: row => row.jobCode,
      width: 18,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[15],
      value: row => row.financialCode,
      width: 18,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[16],
      value: row => row.financialGroupDescription,
      width: 42,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[17],
      value: row => row.currency,
      width: 12,
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[18],
      value: row => row.invoiceTotal,
      width: 18,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[19],
      value: row => row.advances,
      width: 16,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[20],
      value: row => row.totalRetentions,
      width: 20,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[21],
      value: row => row.invoiceNetPayable,
      width: 18,
      numFmt: "#,##0.00",
    },
    {
      header: TREASURY_PAYMENTS_HEADERS[22],
      value: row => row.paidAmount,
      width: 24,
      numFmt: "#,##0.00",
    },
  ];

export function buildTreasuryPaymentsWorksheets<T>(input: {
  batchColumns: ExcelColumn<T>[];
  batches: T[];
  payments: TreasuryPaymentsReportRow[];
}): ExcelWorksheet[] {
  return [
    {
      sheetName: "Lotes de pago",
      columns: input.batchColumns,
      rows: input.batches,
    },
    {
      sheetName: "Payments",
      columns: TREASURY_PAYMENTS_EXPORT_COLUMNS,
      rows: input.payments,
    },
  ];
}
