import * as XLSX from "xlsx";

export type SupplierExcelFileInput = {
  fileName: string;
  fileBase64: string;
};

export type SupplierExcelExistingSupplier = {
  id: number;
  supplierCode: string;
  rtn: string | null;
  allowsTaxWithholding: boolean;
  subjectToAccountPayments: boolean;
};

export type SupplierExcelImportIssue = {
  rowNumber?: number;
  field?: string;
  message: string;
};

export type SupplierExcelImportAction = "insert" | "update";

export type SupplierExcelImportPlanRow = {
  rowNumber: number;
  supplierCode: string;
  generatedCode: boolean;
  name: string;
  rtn: string;
  address: string | null;
  email: string | null;
  allowsTaxWithholding: boolean;
  subjectToAccountPayments: boolean;
  action: SupplierExcelImportAction;
  existingSupplierId: number | null;
};

export type SupplierExcelImportAnalysis = {
  sheetName: string | null;
  totalRows: number;
  validRows: number;
  insertCount: number;
  updateCount: number;
  generatedCodeCount: number;
  errors: SupplierExcelImportIssue[];
  warnings: SupplierExcelImportIssue[];
  preview: SupplierExcelImportPlanRow[];
  rows: SupplierExcelImportPlanRow[];
};

export type SupplierExcelImportSummary = Omit<SupplierExcelImportAnalysis, "rows">;

type SupplierExcelColumnKey =
  | "supplierCode"
  | "name"
  | "rtn"
  | "fiscalResidence"
  | "subjectToAccountPayments"
  | "relatedCompany"
  | "address"
  | "phone"
  | "businessLine"
  | "allowsTaxWithholding"
  | "email";

type HeaderMatch = Record<SupplierExcelColumnKey, number>;

type ParsedSupplierExcelRow = {
  rowNumber: number;
  supplierCode: string;
  name: string;
  rtn: string;
  address: string | null;
  email: string | null;
  allowsTaxWithholding?: boolean;
  subjectToAccountPayments?: boolean;
};

type ParsedSupplierExcelFile = {
  sheetName: string | null;
  rows: ParsedSupplierExcelRow[];
  errors: SupplierExcelImportIssue[];
  warnings: SupplierExcelImportIssue[];
};

const PREVIEW_ROWS = 10;
const GENERATED_CODE_PREFIX = "PROV-";
const GENERATED_CODE_WIDTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const REQUIRED_HEADERS: Array<{
  key: SupplierExcelColumnKey;
  labels: string[];
}> = [
  { key: "supplierCode", labels: ["codigo", "codigo sn"] },
  { key: "name", labels: ["nombre proveedor", "nombre sn", "nombre"] },
  { key: "rtn", labels: ["rtn"] },
  { key: "fiscalResidence", labels: ["residencia fiscal"] },
  { key: "subjectToAccountPayments", labels: ["pagos a cuenta"] },
  { key: "relatedCompany", labels: ["cia relacionada", "compania relacionada"] },
  { key: "address", labels: ["direccion"] },
  { key: "phone", labels: ["telefono"] },
  { key: "businessLine", labels: ["rubro"] },
  { key: "allowsTaxWithholding", labels: ["retencion 12%"] },
  { key: "email", labels: ["e mail", "email", "correo"] },
];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-.?¿!¡]+/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeCell(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function decodeWorkbook(input: SupplierExcelFileInput) {
  const fileName = input.fileName.trim();
  if (!/\.xlsx$/i.test(fileName)) {
    throw new Error("Seleccione un archivo .xlsx de proveedores");
  }

  const base64 = input.fileBase64.includes(",")
    ? input.fileBase64.split(",").pop() ?? ""
    : input.fileBase64;

  if (!base64.trim()) {
    throw new Error("El archivo Excel esta vacio");
  }

  try {
    return XLSX.read(Buffer.from(base64, "base64"), {
      type: "buffer",
      cellDates: false,
    });
  } catch {
    throw new Error("No se pudo leer el archivo Excel");
  }
}

function getRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils
    .sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    })
    .map(row => row.map(normalizeCell))
    .filter(row => row.some(cell => cell.length > 0));
}

function matchHeaders(row: string[]): HeaderMatch | null {
  const normalized = row.map(normalizeHeader);
  const matches = {} as Partial<HeaderMatch>;

  for (const header of REQUIRED_HEADERS) {
    const index = normalized.findIndex(value => header.labels.includes(value));
    if (index < 0) return null;
    matches[header.key] = index;
  }

  return matches as HeaderMatch;
}

function getSheetRows(workbook: XLSX.WorkBook) {
  const preferredSheetName = workbook.SheetNames.find(
    sheetName => normalizeHeader(sheetName) === "proveedores"
  );
  const candidates = [
    ...(preferredSheetName ? [preferredSheetName] : []),
    ...workbook.SheetNames.filter(sheetName => sheetName !== preferredSheetName),
  ];

  for (const sheetName of candidates) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = getRows(sheet);
    if (rows.length === 0) continue;
    const header = matchHeaders(rows[0]);
    if (header) return { sheetName, rows, header };
  }

  const firstSheetName = workbook.SheetNames[0] ?? null;
  const firstSheetRows = firstSheetName ? getRows(workbook.Sheets[firstSheetName]) : [];
  return { sheetName: firstSheetName, rows: firstSheetRows, header: null };
}

function parseBooleanCell(
  value: string,
  rowNumber: number,
  field: string,
  label: string
) {
  const trimmed = value.trim();
  if (!trimmed) return { value: undefined, warning: null };

  const normalized = normalizeHeader(trimmed);
  if (["si", "sí", "yes", "true", "1"].includes(normalized)) {
    return { value: true, warning: null };
  }
  if (["no", "false", "0"].includes(normalized)) {
    return { value: false, warning: null };
  }

  return {
    value: undefined,
    warning: {
      rowNumber,
      field,
      message: `${label} tiene un valor no reconocido: "${trimmed}"`,
    } satisfies SupplierExcelImportIssue,
  };
}

function extractEmail(value: string, rowNumber: number) {
  const raw = value.trim();
  if (!raw) return { email: null, warning: null };

  const chunks = raw
    .split(/[,;\n]+/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    if (EMAIL_PATTERN.test(chunk)) {
      return {
        email: chunk.slice(0, 320),
        warning:
          chunks.length > 1 || chunk !== raw
            ? {
                rowNumber,
                field: "email",
                message: `Se usara el primer correo valido de "${raw}"`,
              }
            : null,
      };
    }

    const token = chunk
      .split(/\s+/)
      .map(part => part.trim())
      .find(part => EMAIL_PATTERN.test(part));
    if (token) {
      return {
        email: token.slice(0, 320),
        warning: {
          rowNumber,
          field: "email",
          message: `Se usara el correo valido "${token}" de "${raw}"`,
        },
      };
    }
  }

  return {
    email: null,
    warning: {
      rowNumber,
      field: "email",
      message: `No se importara el correo porque no tiene formato valido: "${raw}"`,
    } satisfies SupplierExcelImportIssue,
  };
}

export function parseSupplierExcelWorkbook(
  input: SupplierExcelFileInput
): ParsedSupplierExcelFile {
  const workbook = decodeWorkbook(input);
  const { sheetName, rows, header } = getSheetRows(workbook);

  if (!header) {
    return {
      sheetName,
      rows: [],
      errors: [
        {
          message:
            "El archivo debe incluir los encabezados: CODIGO, NOMBRE PROVEEDOR, RTN, Residencia_Fiscal, Pagos_A_Cuenta..?, Cia_Relacionada, Direccion, Telefono, Rubro, Retencion 12%, E-Mail",
        },
      ],
      warnings: [],
    };
  }

  const errors: SupplierExcelImportIssue[] = [];
  const warnings: SupplierExcelImportIssue[] = [];
  const parsedRows: ParsedSupplierExcelRow[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const supplierCode = row[header.supplierCode]?.trim() ?? "";
    const name = row[header.name]?.trim() ?? "";
    const rtn = row[header.rtn]?.trim() ?? "";
    const address = row[header.address]?.trim() || null;
    const emailResult = extractEmail(row[header.email] ?? "", rowNumber);
    const accountPayments = parseBooleanCell(
      row[header.subjectToAccountPayments] ?? "",
      rowNumber,
      "subjectToAccountPayments",
      "Pagos a cuenta"
    );
    const taxWithholding = parseBooleanCell(
      row[header.allowsTaxWithholding] ?? "",
      rowNumber,
      "allowsTaxWithholding",
      "Retencion 12%"
    );

    if (!supplierCode && !name && !rtn) return;

    if (!name) {
      errors.push({
        rowNumber,
        field: "name",
        message: "El nombre del proveedor es requerido",
      });
    }
    if (!rtn) {
      errors.push({
        rowNumber,
        field: "rtn",
        message: "El RTN del proveedor es requerido",
      });
    }
    if (supplierCode.length > 50) {
      errors.push({
        rowNumber,
        field: "supplierCode",
        message: "El codigo del proveedor no puede superar 50 caracteres",
      });
    }
    if (name.length > 500) {
      errors.push({
        rowNumber,
        field: "name",
        message: "El nombre del proveedor no puede superar 500 caracteres",
      });
    }
    if (rtn.length > 50) {
      errors.push({
        rowNumber,
        field: "rtn",
        message: "El RTN del proveedor no puede superar 50 caracteres",
      });
    }

    if (emailResult.warning) warnings.push(emailResult.warning);
    if (accountPayments.warning) warnings.push(accountPayments.warning);
    if (taxWithholding.warning) warnings.push(taxWithholding.warning);

    parsedRows.push({
      rowNumber,
      supplierCode,
      name,
      rtn,
      address,
      email: emailResult.email,
      allowsTaxWithholding: taxWithholding.value,
      subjectToAccountPayments: accountPayments.value,
    });
  });

  if (parsedRows.length === 0) {
    errors.push({
      message: "El archivo no contiene filas de proveedores para importar",
    });
  }

  return { sheetName, rows: parsedRows, errors, warnings };
}

function getNextSupplierCode(
  usedCodes: Set<string>,
  startAt: number
): { code: string; next: number } {
  let next = Math.max(1, startAt);
  while (true) {
    const code = `${GENERATED_CODE_PREFIX}${String(next).padStart(
      GENERATED_CODE_WIDTH,
      "0"
    )}`;
    next += 1;
    if (!usedCodes.has(normalizeKey(code))) {
      usedCodes.add(normalizeKey(code));
      return { code, next };
    }
  }
}

function getNextGeneratedNumber(existingSuppliers: SupplierExcelExistingSupplier[]) {
  let max = 0;
  for (const supplier of existingSuppliers) {
    const match = supplier.supplierCode.match(/^PROV-(\d+)$/i);
    if (!match) continue;
    max = Math.max(max, Number(match[1]) || 0);
  }
  return max + 1;
}

function addDuplicateErrors(
  rows: ParsedSupplierExcelRow[],
  errors: SupplierExcelImportIssue[]
) {
  const rtnRows = new Map<string, number[]>();
  const codeRtns = new Map<string, Set<string>>();

  for (const row of rows) {
    const rtnKey = normalizeKey(row.rtn);
    if (rtnKey) {
      rtnRows.set(rtnKey, [...(rtnRows.get(rtnKey) ?? []), row.rowNumber]);
    }

    const codeKey = normalizeKey(row.supplierCode);
    if (codeKey) {
      const set = codeRtns.get(codeKey) ?? new Set<string>();
      set.add(rtnKey);
      codeRtns.set(codeKey, set);
    }
  }

  for (const [rtn, rowNumbers] of Array.from(rtnRows.entries())) {
    if (rowNumbers.length > 1) {
      errors.push({
        field: "rtn",
        message: `RTN duplicado en el archivo (${rtn}) en filas ${rowNumbers.join(", ")}`,
      });
    }
  }

  for (const [code, rtns] of Array.from(codeRtns.entries())) {
    if (rtns.size > 1) {
      errors.push({
        field: "supplierCode",
        message: `Codigo duplicado con RTN distinto en el archivo: ${code}`,
      });
    }
  }
}

export function buildSupplierExcelImportAnalysis(
  parsed: ParsedSupplierExcelFile,
  existingSuppliers: SupplierExcelExistingSupplier[]
): SupplierExcelImportAnalysis {
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  addDuplicateErrors(parsed.rows, errors);

  const existingByCode = new Map(
    existingSuppliers.map(supplier => [normalizeKey(supplier.supplierCode), supplier])
  );
  const existingByRtn = new Map<string, SupplierExcelExistingSupplier>();
  for (const supplier of existingSuppliers) {
    const rtnKey = normalizeKey(supplier.rtn);
    if (rtnKey && !existingByRtn.has(rtnKey)) {
      existingByRtn.set(rtnKey, supplier);
    }
  }

  const usedCodes = new Set(
    existingSuppliers.map(supplier => normalizeKey(supplier.supplierCode))
  );
  for (const row of parsed.rows) {
    if (row.supplierCode) usedCodes.add(normalizeKey(row.supplierCode));
  }

  let nextGeneratedNumber = getNextGeneratedNumber(existingSuppliers);
  const rows: SupplierExcelImportPlanRow[] = [];

  for (const row of parsed.rows) {
    const providedCode = row.supplierCode.trim();
    const existingByProvidedCode = providedCode
      ? existingByCode.get(normalizeKey(providedCode))
      : undefined;
    const existingByRowRtn = existingByRtn.get(normalizeKey(row.rtn));

    if (
      providedCode &&
      existingByRowRtn &&
      existingByRowRtn.supplierCode !== providedCode &&
      !existingByProvidedCode
    ) {
      errors.push({
        rowNumber: row.rowNumber,
        field: "rtn",
        message: `El RTN ya existe con el codigo ${existingByRowRtn.supplierCode}; quite el codigo o use el proveedor existente`,
      });
    }

    const existingSupplier = existingByProvidedCode ?? existingByRowRtn ?? null;
    const action: SupplierExcelImportAction = existingSupplier ? "update" : "insert";
    const generated = !providedCode && !existingSupplier;
    let supplierCode = providedCode || existingSupplier?.supplierCode || "";

    if (generated) {
      const generatedResult = getNextSupplierCode(usedCodes, nextGeneratedNumber);
      supplierCode = generatedResult.code;
      nextGeneratedNumber = generatedResult.next;
    }

    const allowsTaxWithholding =
      row.allowsTaxWithholding ??
      existingSupplier?.allowsTaxWithholding ??
      true;
    const subjectToAccountPayments =
      row.subjectToAccountPayments ??
      existingSupplier?.subjectToAccountPayments ??
      true;

    rows.push({
      rowNumber: row.rowNumber,
      supplierCode,
      generatedCode: generated,
      name: row.name,
      rtn: row.rtn,
      address: row.address,
      email: row.email,
      allowsTaxWithholding,
      subjectToAccountPayments,
      action,
      existingSupplierId: existingSupplier?.id ?? null,
    });
  }

  const insertCount = rows.filter(row => row.action === "insert").length;
  const updateCount = rows.filter(row => row.action === "update").length;

  return {
    sheetName: parsed.sheetName,
    totalRows: parsed.rows.length,
    validRows: errors.length === 0 ? parsed.rows.length : 0,
    insertCount,
    updateCount,
    generatedCodeCount: rows.filter(row => row.generatedCode).length,
    errors,
    warnings,
    preview: rows.slice(0, PREVIEW_ROWS),
    rows,
  };
}

export function summarizeSupplierExcelImportAnalysis(
  analysis: SupplierExcelImportAnalysis
): SupplierExcelImportSummary {
  const { rows: _rows, ...summary } = analysis;
  return summary;
}
