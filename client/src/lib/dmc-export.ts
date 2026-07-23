import type {
  DmcSar52752Row,
  DmcSar52753Row,
  DmcSar52754Row,
  DmcSarReportPayload,
} from "@shared/dmc-sar-report";
import type {
  RetentionSarPayload,
  RetentionSarRow,
  RetentionSarType,
} from "@shared/retention-sar-report";
import {
  SYSTEM_INVOICE_HEADERS,
  SYSTEM_ORDER_HEADERS,
  type SystemWorkbookPayload,
} from "@shared/system-workbook-report";

type Xlsx = typeof import("xlsx");
type Workbook = ReturnType<Xlsx["utils"]["book_new"]>;

const DMC_52_HEADERS = [
  "200-RTN",
  "600-Clase de documento",
  "7-CAI",
  "8-Nº documento (establecimiento - punto de emisión - tipo documento - correlativo)",
  "71-Nº documento",
  "900-Fecha emisión",
  "100-Fecha contable",
  "140-Nº OCE",
  "110-Importe exento",
  "130-Nº resolución",
  "1201-Importe exonerado al 15%",
  "1202-Importe exonerado al 18%",
  "1511-Importe base 15%",
  "1611-Importe base 18%",
  "270-Monto al costo",
  "280-Monto al gasto",
  "290-Valor no deducible",
] as const;

const DMC_53_HEADERS = [
  "301-Pasaporte o identificación CA",
  "302-Nº Identificador tributario mercantil",
  "501-Apellidos y nombre/razón social",
  "190-N.º FYDUCA",
  "901-Fecha emisión",
  "101-Fecha contable",
  "141-Nº OCE",
  "111-Importe exento",
  "131-Nº resolución",
  "1211-Importe exonerado al 15%",
  "1212-Importe exonerado al 18%",
  "1512-Importe Base 15%",
  "1612-Importe base 18%",
  "271-Monto al costo",
  "281-Monto al gasto",
  "291-Valor no deducible",
] as const;

const DMC_54_HEADERS = [
  "303-Pasaporte o identificación CA",
  "502-Apellidos y nombre/razón social",
  "20-N.º DUA",
  "902-Fecha emisión",
  "102-Fecha contable",
  "142-Nº OCE",
  "112-Importe exento",
  "132-Nº resolución",
  "1221-Importe exonerado al 15%",
  "1222-Importe exonerado al 18%",
  "1513-Importe Base 15%",
  "1520-Importe base 15% (Fuera región Centroamericana)",
  "1613-Importe base 18%",
  "1620-Importe base 18% (Fuera región Centroamericana)",
  "272-Monto al costo",
  "282-Monto al gasto",
  "292-Valor no deducible",
] as const;

const RETENTION_135_HEADERS = [
  "2-RTN",
  "6-Clase de documento",
  "7-CAI",
  "71-Nº documento (establecimiento - punto de emisión - tipo documento - correlativo)",
  "711-Nº documento",
  "9-Fecha emisión",
  "30-Fecha documento retención",
  "33-Código F01",
  "341-CAI retención",
  "342-Nº documento retención (establecimiento - punto de emisión - tipo documento - correlativo)",
  "32-Código de la institución del estado",
  "44-Importe base mensual retención",
] as const;

const RETENTION_112_HEADERS = [
  "2-RTN",
  "7-CAI",
  "71-Nº documento (establecimiento - punto de emisión - tipo documento - correlativo)",
  "9-Fecha emisión",
  "30-Fecha documento retención",
  "31-Nº justificante retención",
  "33-Código F01",
  "341-CAI retención",
  "342-Nº documento retención (establecimiento - punto de emisión - tipo documento - correlativo)",
  "32-Código de la institución del estado",
  "44-Importe base mensual retención",
] as const;

const RETENTION_217_HEADERS = [
  "2-RTN",
  "6-Clase de documento",
  "7-CAI",
  "71-Nº documento (establecimiento - punto de emisión - tipo documento - correlativo)",
  "711-Nº documento",
  "9-Fecha emisión",
  "30-Fecha documento retención",
  "33-Código F01",
  "341-CAI retención",
  "342-Nº documento retención (establecimiento - punto de emisión - tipo documento - correlativo)",
  "32-Código de la institución del estado",
  "39-Importe base 15%",
  "40-Importe base 18%",
] as const;

function datePart(value: Date | string | null | undefined) {
  if (!value) return "sin-fecha";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "sin-fecha";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function generalRows(taxLabel: string, sections: string[]) {
  const rows = Array.from({ length: Math.max(7, 5 + sections.length) }, () =>
    Array(7).fill(null)
  );
  rows[3][5] = "IMPUESTO: ";
  rows[3][6] = taxLabel;
  rows[4][5] = "SECCIÓN: ";
  sections.forEach((section, index) => {
    rows[4 + index][6] = section;
  });
  return rows;
}

function makeSheet(
  XLSX: Xlsx,
  rows: unknown[][],
  widths: number[],
  options: { dateColumns?: number[]; dataStartRow?: number } = {}
) {
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  sheet["!cols"] = widths.map(wch => ({ wch }));
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (range) {
    for (
      let row = options.dataStartRow ?? 1;
      row <= range.e.r;
      row += 1
    ) {
      for (const column of options.dateColumns ?? []) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.v instanceof Date) cell.z = "dd/mm/yyyy";
      }
      for (let column = 0; column <= range.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
      }
    }
  }
  sheet["!protect"] = { selectLockedCells: false, selectUnlockedCells: false };
  return sheet;
}

function appendHiddenSheet(
  XLSX: Xlsx,
  workbook: Workbook,
  sheet: ReturnType<Xlsx["utils"]["aoa_to_sheet"]>,
  name: string
) {
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  workbook.Workbook = workbook.Workbook ?? {};
  workbook.Workbook.Sheets = workbook.Workbook.Sheets ?? [];
  const index = workbook.SheetNames.indexOf(name);
  workbook.Workbook.Sheets[index] = {
    ...(workbook.Workbook.Sheets[index] ?? {}),
    Hidden: 1,
  };
}

function row52752(row: DmcSar52752Row) {
  return [
    row.supplierRtn,
    row.documentClass,
    row.cai,
    row.fiscalDocumentNumber,
    row.otherDocumentNumber,
    row.documentDate,
    row.postingDate,
    row.oceNumber,
    row.exempt,
    row.oceResolutionNumber,
    row.exonerated15,
    row.exonerated18,
    row.base15,
    row.base18,
    row.cost,
    row.expense,
    row.nonDeductible,
  ];
}

function row52753(row: DmcSar52753Row) {
  return [
    row.foreignIdentification,
    row.foreignTaxIdentifier,
    row.supplierName,
    row.fyducaNumber,
    row.documentDate,
    row.postingDate,
    row.oceNumber,
    row.exempt,
    row.oceResolutionNumber,
    row.exonerated15,
    row.exonerated18,
    row.base15,
    row.base18,
    row.cost,
    row.expense,
    row.nonDeductible,
  ];
}

function row52754(row: DmcSar52754Row) {
  return [
    row.foreignIdentification,
    row.supplierName,
    row.duaNumber,
    row.documentDate,
    row.postingDate,
    row.oceNumber,
    row.exempt,
    row.oceResolutionNumber,
    row.exonerated15,
    row.exonerated18,
    row.base15,
    row.base15OutsideCentralAmerica,
    row.base18,
    row.base18OutsideCentralAmerica,
    row.cost,
    row.expense,
    row.nonDeductible,
  ];
}

export function buildDmc527Workbook(XLSX: Xlsx, payload: DmcSarReportPayload) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      XLSX,
      generalRows("DECLARACIÓN MENSUAL DE COMPRAS (D.M.C.)", [
        "52 - Compras en el mercado interno",
        "53 - FYDUCA",
        "54 - Importaciones",
      ]),
      [2, 2, 2, 2, 2, 14, 58]
    ),
    "General"
  );
  appendHiddenSheet(
    XLSX,
    workbook,
    makeSheet(XLSX, [[null, "FA-Factura"], [null, "OC-Otros comprobantes de pago"]], [2, 34]),
    "Lista"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      XLSX,
      [Array.from(DMC_52_HEADERS), ...payload.section52752.map(row52752)],
      Array(DMC_52_HEADERS.length).fill(18.55),
      { dateColumns: [5, 6] }
    ),
    "527-52"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      XLSX,
      [Array.from(DMC_53_HEADERS), ...payload.section52753.map(row52753)],
      Array(DMC_53_HEADERS.length).fill(13),
      { dateColumns: [4, 5] }
    ),
    "527-53"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      XLSX,
      [Array.from(DMC_54_HEADERS), ...payload.section52754.map(row52754)],
      Array(DMC_54_HEADERS.length).fill(14.1),
      { dateColumns: [3, 4] }
    ),
    "527-54"
  );
  return workbook;
}

function retentionRows(type: RetentionSarType, rows: RetentionSarRow[]) {
  if (type === "RT125") {
    return rows.map(row => [
      row.supplierRtn,
      row.invoiceCai,
      row.fiscalDocumentNumber || row.otherDocumentNumber,
      row.invoiceDate,
      row.retentionDocumentDate,
      row.justificationNumber,
      row.f01Code,
      row.retentionCai,
      row.retentionDocumentNumber,
      row.stateInstitutionCode,
      row.retainedBase,
    ]);
  }
  const common = (row: RetentionSarRow) => [
    row.supplierRtn,
    row.documentClass,
    row.invoiceCai,
    row.fiscalDocumentNumber,
    row.otherDocumentNumber,
    row.invoiceDate,
    row.retentionDocumentDate,
    row.f01Code,
    row.retentionCai,
    row.retentionDocumentNumber,
    row.stateInstitutionCode,
  ];
  return type === "RT15"
    ? rows.map(row => [
        ...common(row),
        row.retainedBase15,
        row.retainedBase18,
      ])
    : rows.map(row => [...common(row), row.retainedBase]);
}

const RETENTION_TEMPLATE = {
  RT01: {
    taxLabel: "RETENCIÓN ANTICIPO 1% ART. 19 DEC. No. 17-2010",
    section: "6 - PRD-Presentación declaración formulario informativo",
    sheetName: "135-6",
    headers: RETENTION_135_HEADERS,
    widths: 18.2,
    dateColumns: [5, 6],
    fileCode: "135",
  },
  RT125: {
    taxLabel: "RETENCIÓN POR SERVICIOS, HONORARIOS (ART. 50)",
    section: "6 - PRD-Presentación declaración formulario informativo",
    sheetName: "112-6",
    headers: RETENTION_112_HEADERS,
    widths: 17.44,
    dateColumns: [3, 4],
    fileCode: "112",
  },
  RT15: {
    taxLabel: "RETENCIÓN I.S.V. ARTÍCULO 8 I.S.V.",
    section: "6 - PRD-Presentación declaración formulario informativo",
    sheetName: "217-6",
    headers: RETENTION_217_HEADERS,
    widths: 13,
    dateColumns: [5, 6],
    fileCode: "217",
  },
} as const;

export function buildRetentionSarWorkbook(
  XLSX: Xlsx,
  payload: RetentionSarPayload
) {
  const template = RETENTION_TEMPLATE[payload.type];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      XLSX,
      generalRows(template.taxLabel, [template.section]),
      [2, 2, 2, 2, 2, 14, 58]
    ),
    "General"
  );
  const listRows =
    payload.type === "RT125"
      ? [[]]
      : [[null, "CF-Comprobantes fiscales"], [null, "OC-Otros comprobantes de pago"]];
  appendHiddenSheet(
    XLSX,
    workbook,
    makeSheet(XLSX, listRows, [2, 34]),
    "Lista"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      XLSX,
      [
        Array.from(template.headers),
        ...retentionRows(payload.type, payload.rows),
      ],
      Array(template.headers.length).fill(template.widths),
      { dateColumns: Array.from(template.dateColumns) }
    ),
    template.sheetName
  );
  return workbook;
}

function systemDateColumns(headers: readonly string[]) {
  const dateNames = new Set([
    "Fecha",
    "F Entrega",
    "Fecha Factura",
    "Fech_Cpte_Retención",
    "Fecha Vencimiento Crédito",
  ]);
  return headers
    .map((header, index) => (dateNames.has(header) ? index + 1 : -1))
    .filter(index => index >= 0);
}

function appendTotals(rows: unknown[][], numericColumns: number[]) {
  const totalRow = Array(rows[0]?.length ?? 0).fill(null);
  totalRow[0] = "TOTAL";
  const dataRows = rows.slice(1);
  numericColumns.forEach(column => {
    totalRow[column] = dataRows.reduce((sum, row) => {
      const value = Number(row[column] ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  });
  rows.push(totalRow);
}

export function buildSystemWorkbook(XLSX: Xlsx, payload: SystemWorkbookPayload) {
  const workbook = XLSX.utils.book_new();
  const orderRows: unknown[][] = [
    [null, null, null, "Llave principal (Financiera)"],
    [null, ...SYSTEM_ORDER_HEADERS],
    ...payload.purchaseOrders.map(row => [
      null,
      row.orderNumber,
      row.job,
      row.financialCode,
      row.date ? new Date(row.date) : null,
      row.supplierRtn,
      row.supplierName,
      row.salesAdvisor,
      row.currency,
      row.orderId,
      row.itemNumber,
      row.partNumber,
      row.description,
      row.quantity,
      row.unitPrice,
      row.subtotal,
      row.tax,
      row.total,
      row.purchaseType,
      row.requestedBy,
      row.deliveryDate ? new Date(row.deliveryDate) : null,
      row.destination,
      row.quoteReference,
      row.status,
    ]),
  ];
  appendTotals(orderRows, [13, 14, 15, 16, 17]);
  const orderSheet = makeSheet(
    XLSX,
    orderRows,
    [2, ...Array(SYSTEM_ORDER_HEADERS.length).fill(17)],
    { dateColumns: systemDateColumns(SYSTEM_ORDER_HEADERS), dataStartRow: 2 }
  );
  XLSX.utils.book_append_sheet(workbook, orderSheet, "Órdenes de Compra");

  const invoiceRows: unknown[][] = [
    [null, null, "Llave principal (Financiera)"],
    [null, ...SYSTEM_INVOICE_HEADERS],
    ...payload.invoices.map(row => [
      null,
      ...SYSTEM_INVOICE_HEADERS.map(header => row[header]),
    ]),
  ];
  appendTotals(
    invoiceRows,
    [11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
  );
  const invoiceSheet = makeSheet(
    XLSX,
    invoiceRows,
    [2, ...Array(SYSTEM_INVOICE_HEADERS.length).fill(17)],
    { dateColumns: systemDateColumns(SYSTEM_INVOICE_HEADERS), dataStartRow: 2 }
  );
  XLSX.utils.book_append_sheet(
    workbook,
    invoiceSheet,
    "Registro Facturacion"
  );
  return workbook;
}

export async function downloadDmcSarReport(payload: DmcSarReportPayload) {
  if (!payload.canExport) {
    throw new Error("Corrija los datos faltantes antes de generar el DMC 527");
  }
  const XLSX = await import("xlsx");
  XLSX.writeFile(
    buildDmc527Workbook(XLSX, payload),
    `DMC-527-${datePart(payload.summary.dateFrom)}-${datePart(payload.summary.dateTo)}.xlsx`,
    { bookType: "xlsx", cellDates: true }
  );
}

export async function downloadRetentionSarReport(payload: RetentionSarPayload) {
  if (!payload.canExport) {
    throw new Error("Corrija los datos faltantes antes de generar la retención SAR");
  }
  const XLSX = await import("xlsx");
  const code = RETENTION_TEMPLATE[payload.type].fileCode;
  XLSX.writeFile(
    buildRetentionSarWorkbook(XLSX, payload),
    `Retencion-${code}-${datePart(payload.summary.dateFrom)}-${datePart(payload.summary.dateTo)}.xlsx`,
    { bookType: "xlsx", cellDates: true }
  );
}

export async function downloadSystemWorkbook(payload: SystemWorkbookPayload) {
  const XLSX = await import("xlsx");
  XLSX.writeFile(
    buildSystemWorkbook(XLSX, payload),
    `BuildReq-Reportes-${datePart(payload.summary.dateFrom)}-${datePart(payload.summary.dateTo)}.xlsx`,
    { bookType: "xlsx", cellDates: true }
  );
}
