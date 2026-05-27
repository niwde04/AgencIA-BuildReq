type CsvCellValue = string | number | boolean | Date | null | undefined;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => CsvCellValue;
};

const CSV_SEPARATOR = ";";

function normalizeCsvValue(value: CsvCellValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("es-HN");
  return String(value);
}

function escapeCsvValue(value: CsvCellValue) {
  const normalizedValue = normalizeCsvValue(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const mustQuote =
    normalizedValue.includes(CSV_SEPARATOR) ||
    normalizedValue.includes('"') ||
    normalizedValue.includes("\n");

  if (!mustQuote) return normalizedValue;

  return `"${normalizedValue.replace(/"/g, '""')}"`;
}

export function buildDatedCsvFileName(baseName: string, date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${baseName}-${year}-${month}-${day}.csv`;
}

export function downloadCsv<T>(
  fileName: string,
  columns: CsvColumn<T>[],
  rows: T[]
) {
  const csvRows = [
    columns.map(column => escapeCsvValue(column.header)).join(CSV_SEPARATOR),
    ...rows.map(row =>
      columns
        .map(column => escapeCsvValue(column.value(row)))
        .join(CSV_SEPARATOR)
    ),
  ];
  const blob = new Blob([`\uFEFF${csvRows.join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
