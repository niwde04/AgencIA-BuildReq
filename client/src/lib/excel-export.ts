type ExcelCellValue = string | number | boolean | Date | null | undefined;

export type ExcelColumn<T> = {
  header: string;
  value: (row: T) => ExcelCellValue;
  width?: number;
  numFmt?: string;
};

function normalizeExcelValue(value: ExcelCellValue) {
  if (value === null || value === undefined) return "";
  return value;
}

function getCellDisplayLength(value: unknown) {
  if (value instanceof Date) return 10;
  return String(value ?? "").length;
}

function getColumnWidth(values: unknown[]) {
  const maxLength = values.reduce<number>(
    (max, value) => Math.max(max, getCellDisplayLength(value)),
    0
  );
  return Math.min(Math.max(maxLength + 2, 10), 48);
}

function sanitizeSheetName(value: string) {
  const cleaned = value.replace(/[\[\]:*?/\\]/g, " ").trim();
  return (cleaned || "Hoja 1").slice(0, 31);
}

export function buildDatedExcelFileName(baseName: string, date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${baseName}-${year}-${month}-${day}.xlsx`;
}

export async function downloadExcel<T>(
  fileName: string,
  sheetName: string,
  columns: ExcelColumn<T>[],
  rows: T[]
) {
  const XLSX = await import("xlsx");
  const data = [
    columns.map(column => column.header),
    ...rows.map(row =>
      columns.map(column => normalizeExcelValue(column.value(row)))
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  worksheet["!cols"] = columns.map((column, columnIndex) => ({
    wch:
      column.width ??
      getColumnWidth(data.map(row => row[columnIndex])),
  }));

  columns.forEach((column, columnIndex) => {
    if (!column.numFmt) return;

    for (let rowIndex = 1; rowIndex < data.length; rowIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({
        r: rowIndex,
        c: columnIndex,
      });
      const cell = worksheet[cellAddress];
      if (cell && typeof cell.v === "number") {
        cell.z = column.numFmt;
      }
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    sanitizeSheetName(sheetName)
  );
  XLSX.writeFile(workbook, fileName, { bookType: "xlsx" });
}
