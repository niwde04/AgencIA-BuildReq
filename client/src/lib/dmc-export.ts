import {
  DMC_COLUMNS,
  type DmcReportPayload,
  type DmcReportRow,
  type DmcStatusMode,
} from "@shared/dmc-report";
import type {
  DmcSarImportRow,
  DmcSarLocalPurchaseRow,
  DmcSarOccasionalPurchaseRow,
  DmcSarOtherReceiptRow,
  DmcSarReportPayload,
} from "@shared/dmc-sar-report";
import {
  downloadWorkbook,
  type ExcelColumn,
  type ExcelWorksheet,
} from "./excel-export";

type SummaryRow = {
  campo: string;
  valor: string | number | Date | null;
};

const STATUS_MODE_LABELS: Record<DmcStatusMode, string> = {
  non_void: "No anuladas",
  registered_only: "Solo contabilizadas",
  all: "Todos los estados",
};

function toDateInputValue(value: Date | string | null | undefined) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDmcFileName(payload: DmcReportPayload) {
  const dateFrom = toDateInputValue(payload.summary.dateFrom) || "sin-inicio";
  const dateTo = toDateInputValue(payload.summary.dateTo) || "sin-fin";
  return `dmc-buildreq-${dateFrom}-${dateTo}.xlsx`;
}

function buildDmcSarFileName(payload: DmcSarReportPayload) {
  const dateFrom = toDateInputValue(payload.summary.dateFrom) || "sin-inicio";
  const dateTo = toDateInputValue(payload.summary.dateTo) || "sin-fin";
  return `dmc-sar-buildreq-${dateFrom}-${dateTo}.xlsx`;
}

function buildSummaryRows(payload: DmcReportPayload): SummaryRow[] {
  const headerRows: SummaryRow[] = [
    { campo: "Fecha de generación", valor: payload.summary.generatedAt },
    { campo: "Fuente", valor: payload.summary.source },
    { campo: "Fecha desde", valor: payload.summary.dateFrom },
    { campo: "Fecha hasta", valor: payload.summary.dateTo },
    {
      campo: "Estados",
      valor: STATUS_MODE_LABELS[payload.summary.statusMode],
    },
    { campo: "Facturas encontradas", valor: payload.summary.invoiceCount },
  ];
  const currencyRows = payload.summary.totalsByCurrency.flatMap(summary => [
    { campo: `Facturas ${summary.currency}`, valor: summary.invoiceCount },
    { campo: `Total base ${summary.currency}`, valor: summary.totalBase },
    { campo: `Total ISV ${summary.currency}`, valor: summary.totalIsv },
    { campo: `Total factura ${summary.currency}`, valor: summary.totalFactura },
    {
      campo: `Total retención ${summary.currency}`,
      valor: summary.totalRetencion,
    },
    { campo: `Neto a pagar ${summary.currency}`, valor: summary.netoPagar },
  ]);
  return [
    ...headerRows,
    ...currencyRows,
    {
      campo: "Nota",
      valor:
        payload.summary.invoiceCount === 0
          ? "No hay facturas para el rango y estado seleccionados"
          : "Reporte generado desde datos actuales de BuildReq",
    },
  ];
}

export async function downloadDmcReport(payload: DmcReportPayload) {
  const dmcColumns: ExcelColumn<DmcReportRow>[] = DMC_COLUMNS.map(column => ({
    header: column.header,
    width: column.width,
    numFmt: "numFmt" in column ? column.numFmt : undefined,
    value: row => row[column.key],
  }));

  const summaryColumns: ExcelColumn<SummaryRow>[] = [
    {
      header: "Campo",
      width: 28,
      value: row => row.campo,
    },
    {
      header: "Valor",
      width: 42,
      numFmt: "#,##0.00",
      value: row => row.valor,
    },
  ];

  const sheets: ExcelWorksheet[] = [
    {
      sheetName: "Hoja1",
      columns: dmcColumns,
      rows: payload.rows,
    },
    {
      sheetName: "Resumen",
      columns: summaryColumns,
      rows: buildSummaryRows(payload),
    },
  ];

  await downloadWorkbook(buildDmcFileName(payload), sheets);
}

type SarSheetDefinition = {
  sheetName: string;
  rows: any[][];
  merges?: string[];
  widths: number[];
  dateColumns?: number[];
  moneyColumns?: number[];
  dataStartRowIndex: number;
};

function buildSarWorksheet(
  XLSX: typeof import("xlsx"),
  definition: SarSheetDefinition
) {
  const worksheet = XLSX.utils.aoa_to_sheet(definition.rows);
  worksheet["!cols"] = definition.widths.map(wch => ({ wch }));
  worksheet["!merges"] = definition.merges?.map(range =>
    XLSX.utils.decode_range(range)
  );

  for (
    let rowIndex = definition.dataStartRowIndex;
    rowIndex < definition.rows.length;
    rowIndex += 1
  ) {
    for (const columnIndex of definition.dateColumns ?? []) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address];
      if (cell?.v instanceof Date) {
        cell.z = "dd/mm/yyyy";
      }
    }

    for (const columnIndex of definition.moneyColumns ?? []) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address];
      if (cell && typeof cell.v === "number") {
        cell.z = "#,##0.00";
      }
    }
  }

  return worksheet;
}

function localPurchaseRow(row: DmcSarLocalPurchaseRow) {
  return [
    row.rtnProveedor,
    row.razonSocialProveedor,
    row.fecha,
    row.cai,
    row.establecimiento,
    row.puntoEmision,
    row.tipoDocumento,
    row.correlativo,
    row.compraConOce,
    row.oceResolutionNumber,
    row.oceResolutionDate,
    row.importeExento,
    row.importeGravado15,
    row.importeGravado18,
    row.impuesto15,
    row.impuesto18,
  ];
}

function otherReceiptRow(row: DmcSarOtherReceiptRow) {
  return [
    row.tipoDocumento,
    row.fecha,
    row.rtnProveedor,
    row.razonSocialProveedor,
    row.numeroDocumentoEquivalente,
    row.compraConOce,
    row.oceResolutionNumber,
    row.oceResolutionDate,
    row.importeExento,
    row.importeGravado15,
    row.importeGravado18,
    row.impuesto15,
    row.impuesto18,
  ];
}

function occasionalPurchaseRow(row: DmcSarOccasionalPurchaseRow) {
  return [
    row.rtn,
    row.identidadOCarnetResidencia,
    row.pasaporte,
    row.razonSocialProveedor,
    row.departamento,
    row.municipio,
    row.descripcionProductoServicio,
    row.fecha,
    row.cai,
    row.establecimiento,
    row.puntoEmision,
    row.tipoDocumento,
    row.correlativo,
    row.importeExento,
    row.importeGravado15,
    row.importeGravado18,
    row.impuesto15,
    row.impuesto18,
  ];
}

function importRow(row: DmcSarImportRow) {
  return [
    row.identificadorTributarioProveedor,
    row.razonSocialProveedor,
    row.numeroDua,
    row.numeroLiquidacion,
    row.numeroResolucionExoneracionSefin,
    row.fechaVencimientoResolucion,
  ];
}

export function buildSarSheetDefinitions(
  payload: DmcSarReportPayload
): SarSheetDefinition[] {
  return [
    {
      sheetName: "Detalle Compras",
      rows: [
        [
          "HOJA EXCEL No.1 DETALLE COMPRAS LOCALES",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
        [
          null,
          null,
          null,
          null,
          "NÚMERO DE DOCUMENTO FISCAL",
          null,
          null,
          null,
          "ORDENES DE COMPRA EXCENTA (OCE)",
          null,
          null,
          "SUB TOTAL DE COMPRAS",
          null,
          null,
          "CRÉDITO FISCAL ISV",
          null,
        ],
        [
          "R.T.N. DEL PROVEEDOR",
          "NOMBRES APELLIDOS O RAZÓN SOCIAL DEL PROVEEDOR",
          "FECHA DD/MM/AAAA",
          "\t\tCAI\t\t",
          "ESTABLECIMIENTO",
          "PUNTO DE EMISIÓN",
          "TIPO DE DOCUMENTO",
          "CORRELATIVO",
          "COMPRA CON OCE",
          "No. RESOLUCIÓN",
          "FECHA DE LA RESOLUCIÓN DD/MM/AAAA",
          "IMPORTE EXENTO",
          "IMPORTE GRAVADO 15%",
          "IMPORTE GRAVADO 18%",
          "IMPUESTO 15%",
          "IMPUESTO 18%",
        ],
        ...payload.detalleCompras.map(localPurchaseRow),
      ],
      merges: ["A1:C1", "E2:H2", "I2:K2", "L2:N2", "O2:P2"],
      widths: [
        20.43, 48.86, 19.29, 33, 16.57, 17.57, 19.57, 12.57, 16.57, 15.14,
        36.29, 15.86, 21.86, 21.86, 13.71, 13.71,
      ],
      dateColumns: [2, 10],
      moneyColumns: [11, 12, 13, 14, 15],
      dataStartRowIndex: 3,
    },
    {
      sheetName: "Otros Comprobantes de Compra",
      rows: [
        [
          "HOJA EXCEL No.2 DETALLE OTROS COMPROBANTES DE COMPRAS",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
        [
          null,
          null,
          null,
          null,
          null,
          "ORDENES DE COMPRA EXENTA (OCE)",
          null,
          null,
          "SUB TOTAL DE COMPRAS",
          null,
          null,
          "CRÉDITO FISCAL",
          null,
        ],
        [
          "TIPO DE DOCUMENTO",
          "FECHA DD/MM/AAAA",
          "R.T.N.  PROVEEDOR",
          "NOMBRES APELLIDOS O RAZÓN SOCIAL",
          "NÚMERO DE DOCUMENTO EQUIVALENTE",
          "COMPRA CON OCE",
          "No. RESOLUCIÓN ",
          "FECHA DE LA RESOLUCIÓN",
          "IMPORTE EXENTO",
          "IMPORTE GRAVADO 15%",
          "IMPORTE GRAVADO 18%",
          "IMPUESTO 15%",
          "IMPUESTO 18%",
        ],
        ...payload.otrosComprobantes.map(otherReceiptRow),
      ],
      merges: ["A1:C1", "F2:H2", "I2:K2", "L2:M2"],
      widths: [
        19.57, 19.29, 17.29, 34, 36, 16.57, 15.14, 23, 15.86, 21.86,
        21.86, 13.71, 13.71,
      ],
      dateColumns: [1, 7],
      moneyColumns: [8, 9, 10, 11, 12],
      dataStartRowIndex: 3,
    },
    {
      sheetName: "Compras Eventuales",
      rows: [
        [
          "HOJA EXCEL No.3 DETALLE COMPROBANTE DE COMPRAS EVENTUALES DE BIENES Y SERVICIOS",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
        [
          "DATOS DEL PROVEEDOR",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          "NÚMERO DE COMPROBANTE",
          null,
          null,
          null,
          "SUB TOTAL DE COMPRAS",
          null,
          null,
          "IMPUESTO RETENIDO",
          null,
        ],
        [
          "\t\tR.T.N.\t\t",
          "IDENTIDAD Ó CARNET DE RESIDENTE ",
          "PASAPORTE ",
          "NOMBRES APELLIDOS O RAZÓN SOCIAL",
          "DEPARTAMENTO",
          "MUNICIPIO",
          "DESCRIPCIÓN DEL PRODUCTO O SERVICIO",
          "FECHA DD/MM/AAAA",
          "\t\tCAI\t\t",
          "ESTABLECIMIENTO",
          "PUNTO DE EMISIÓN",
          "TIPO DE DOCUMENTO",
          "CORRELATIVO",
          "IMPORTE EXENTO",
          "IMPORTE GRAVADO 15%",
          "IMPORTE GRAVADO 18%",
          "IMPUESTO 15%",
          "IMPUESTO 18%",
        ],
        ...payload.comprasEventuales.map(occasionalPurchaseRow),
      ],
      merges: ["A1:C1", "A2:G2", "J2:M2", "N2:P2", "Q2:R2"],
      widths: [
        16.86, 32, 10.57, 34, 15, 10.14, 36.14, 19.29, 33, 16.57, 17.57,
        19.57, 12.57, 15.86, 21.86, 21.86, 13.71, 13.71,
      ],
      dateColumns: [7],
      moneyColumns: [13, 14, 15, 16, 17],
      dataStartRowIndex: 3,
    },
    {
      sheetName: "Detalle Importaciones",
      rows: [
        [
          "HOJA EXCEL No. 4 DETALLE IMPORTACIONES",
          null,
          null,
          null,
          null,
          null,
        ],
        [
          "IDENTIFICADOR TRIBUTARIO DEL PROVEEDOR ",
          "NOMBRES APELLIDOS O RAZÓN SOCIAL DEL PROVEEDOR ",
          "NÚMERO DE LA DUA ",
          "NÚMERO DE LA LIQUIDACIÓN  ",
          "NÚMERO DE LA RESOLUCIÓN DE EXONERACIÓN (SEFIN)",
          "FECHA DE VENCIMIENTO DE LA RESOLUCIÓN DD/MM/AAAA",
        ],
        ...payload.detalleImportaciones.map(importRow),
      ],
      merges: ["A1:C1"],
      widths: [39.71, 48.86, 18.29, 26, 48, 51.86],
      dateColumns: [5],
      dataStartRowIndex: 2,
    },
  ];
}

export async function downloadDmcSarReport(payload: DmcSarReportPayload) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  for (const definition of buildSarSheetDefinitions(payload)) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildSarWorksheet(XLSX, definition),
      definition.sheetName
    );
  }

  XLSX.writeFile(workbook, buildDmcSarFileName(payload), {
    bookType: "xlsx",
    cellDates: true,
  });
}
