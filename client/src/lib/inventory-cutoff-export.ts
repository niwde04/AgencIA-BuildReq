import type { InventoryCutoffReport } from "@shared/inventory-cutoff-report";
import { downloadWorkbook, type ExcelWorksheet } from "./excel-export";

export function formatInventoryCutoffDate(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: "America/Tegucigalpa",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function reportObservations(
  report: InventoryCutoffReport,
  observations: string,
  unavailableStock = false,
  includeReportContext = false
) {
  return [
    ...(includeReportContext
      ? [
          `Corte: ${formatInventoryCutoffDate(report.cutoffDate)} (Honduras).`,
          `Movimientos desde ${formatInventoryCutoffDate(report.periodStartDate)}.`,
          report.coverage.kind === "documentary_partial"
            ? "Reconstrucción documental parcial."
            : "Movimientos registrados.",
          report.coverage.message,
          ...report.coverage.warnings,
        ]
      : []),
    unavailableStock
      ? "Stock N/D: saldo no disponible para esta ubicación."
      : "",
    observations,
  ]
    .map(value => value.trim())
    .filter(Boolean)
    .join(" ");
}

export function buildInventoryCutoffSheets(
  report: InventoryCutoffReport
): ExcelWorksheet[] {
  return [
    {
      sheetName: "Inventario",
      columns: [
        { header: "Código SAP", value: row => row.sapItemCode, width: 16 },
        { header: "Descripción", value: row => row.description, width: 44 },
        { header: "Marca", value: row => row.brand, width: 18 },
        { header: "No. parte", value: row => row.partNumber, width: 18 },
        { header: "Categoría", value: row => row.category, width: 22 },
        { header: "Unidad", value: row => row.unit, width: 12 },
        {
          header: "Stock",
          value: row => row.stock ?? "N/D",
          numFmt: "#,##0.00",
        },
        {
          header: "Total requeridas",
          value: row =>
            row.pendingReferenceOnly ? "" : (row.totalRequired ?? "N/D"),
          numFmt: "#,##0.00",
        },
        {
          header: "Por recibirse",
          value: row =>
            row.pendingReferenceOnly ? "" : (row.pendingReceipt ?? "N/D"),
          numFmt: "#,##0.00",
        },
        {
          header: "Proyecto / bodega",
          value: row => row.projectLabel,
          width: 32,
        },
        {
          header: "Almacén físico",
          value: row => row.warehouseLabel,
          width: 32,
        },
        { header: "Ubicación", value: row => row.storageLocation, width: 24 },
        {
          header: "Observaciones",
          value: row =>
            reportObservations(
              report,
              row.observations,
              row.stock === null,
              row === report.inventory[0]
            ),
          width: 80,
        },
      ],
      rows: report.inventory,
    },
    {
      sheetName: "Recepcion_Bodega",
      columns: [
        { header: "No Recepcion", value: row => row.receiptNumber, width: 24 },
        {
          header: "Fecha Factura",
          value: row => formatInventoryCutoffDate(row.invoiceDate),
          width: 16,
        },
        { header: "No Factura:", value: row => row.invoiceNumber, width: 24 },
        {
          header: "Fecha Ingreso",
          value: row => formatInventoryCutoffDate(row.entryDate),
          width: 16,
        },
        { header: "Job o Proyecto", value: row => row.projectLabel, width: 32 },
        {
          header: "Bodega Ingreso",
          value: row => row.warehouseLabel,
          width: 32,
        },
        { header: "Tipo Documento", value: row => row.documentType, width: 28 },
        { header: "Destino", value: row => row.destination, width: 40 },
        { header: "Código Empresa", value: row => row.sapItemCode, width: 16 },
        { header: "Artículo recibido", value: row => row.itemName, width: 44 },
        { header: "Marca", value: row => row.brand, width: 18 },
        { header: "No. Partes", value: row => row.partNumber, width: 18 },
        { header: "U.M.", value: row => row.unit, width: 12 },
        {
          header: "Cantidad",
          value: row => row.quantity,
          numFmt: "#,##0.00",
        },
        { header: "Ubicación", value: row => row.storageLocation, width: 24 },
        {
          header: "Observaciones",
          value: row =>
            reportObservations(
              report,
              row.observations,
              false,
              row === report.entries[0]
            ),
          width: 80,
        },
      ],
      rows: report.entries,
    },
    {
      sheetName: "Salida_de_Inventario",
      columns: [
        {
          header: "No. Salida Bodega",
          value: row => row.exitNumber,
          width: 24,
        },
        {
          header: "Fecha Salida",
          value: row => formatInventoryCutoffDate(row.exitDate),
          width: 16,
        },
        {
          header: "Job Dueño Stock",
          value: row => row.ownerProjectLabel,
          width: 32,
        },
        {
          header: "Proyecto Solicitante",
          value: row => row.requestingProjectLabel,
          width: 32,
        },
        {
          header: "Almacén físico:",
          value: row => row.warehouseLabel,
          width: 32,
        },
        { header: "Destino", value: row => row.destination, width: 40 },
        { header: "Codigo Empresa", value: row => row.sapItemCode, width: 16 },
        { header: "Identificador", value: row => row.itemName, width: 44 },
        { header: "U.M.", value: row => row.unit, width: 12 },
        {
          header: "Cantidad",
          value: row => row.quantity,
          numFmt: "#,##0.00",
        },
        { header: "Referencia", value: row => row.reference, width: 40 },
        { header: "Ubicación", value: row => row.storageLocation, width: 24 },
        {
          header: "Observaciones",
          value: row =>
            reportObservations(
              report,
              row.observations,
              false,
              row === report.exits[0]
            ),
          width: 80,
        },
      ],
      rows: report.exits,
    },
  ];
}

export async function downloadInventoryCutoffReport(
  report: InventoryCutoffReport
) {
  await downloadWorkbook(
    `detalle-inventario-entradas-salidas-${report.cutoffDate}.xlsx`,
    buildInventoryCutoffSheets(report)
  );
}
