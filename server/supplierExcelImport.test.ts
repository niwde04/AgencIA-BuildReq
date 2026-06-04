import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildSupplierExcelImportAnalysis,
  parseSupplierExcelWorkbook,
  type SupplierExcelExistingSupplier,
} from "./_core/supplierExcelImport";

const HEADER = [
  "CODIGO",
  "NOMBRE PROVEEDOR",
  "RTN",
  "Residencia_Fiscal",
  "Pagos_A_Cuenta..?",
  "Cia_Relacionada",
  "Dirección",
  "Teléfono",
  "Rubro",
  "Retención 12%",
  "E-Mail",
];

function buildWorkbookBase64(rows: unknown[][], sheetName = "PROVEEDORES") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buffer).toString("base64");
}

function analyze(
  rows: unknown[][],
  existingSuppliers: SupplierExcelExistingSupplier[] = []
) {
  const parsed = parseSupplierExcelWorkbook({
    fileName: "proveedores.xlsx",
    fileBase64: buildWorkbookBase64(rows),
  });
  return buildSupplierExcelImportAnalysis(parsed, existingSuppliers);
}

describe("supplier Excel import parser", () => {
  it("generates sequential codes for valid suppliers without code", () => {
    const analysis = analyze([
      HEADER,
      [
        "",
        "ABCO HONDURAS SA DE CV",
        "08011999000123",
        "Local",
        "SI",
        "NO",
        "San Pedro Sula",
        "9999-9999",
        "Construccion",
        "NO",
        "ventas@abco.com",
      ],
    ]);

    expect(analysis.errors).toEqual([]);
    expect(analysis.rows[0]).toMatchObject({
      supplierCode: "PROV-000001",
      generatedCode: true,
      name: "ABCO HONDURAS SA DE CV",
      rtn: "08011999000123",
      address: "San Pedro Sula",
      email: "ventas@abco.com",
      subjectToAccountPayments: true,
      allowsTaxWithholding: false,
      action: "insert",
    });
  });

  it("blocks files with invalid headers", () => {
    const analysis = analyze([
      ["Nombre", "RTN"],
      ["Proveedor", "0801"],
    ]);

    expect(analysis.errors[0]?.message).toContain("encabezados");
    expect(analysis.rows).toHaveLength(0);
  });

  it("blocks missing supplier name and rtn", () => {
    const analysis = analyze([
      HEADER,
      ["PROV-000001", "", "", "Local", "", "", "", "", "", "", ""],
    ]);

    expect(analysis.errors.map(error => error.field)).toEqual(["name", "rtn"]);
  });

  it("warns and leaves email empty when no valid email is available", () => {
    const analysis = analyze([
      HEADER,
      [
        "",
        "PROVEEDOR SIN EMAIL",
        "08011999000124",
        "Local",
        "",
        "",
        "",
        "",
        "",
        "",
        "gerenciacendema.com",
      ],
    ]);

    expect(analysis.errors).toEqual([]);
    expect(analysis.rows[0]?.email).toBeNull();
    expect(analysis.warnings[0]?.message).toContain("correo");
  });

  it("blocks duplicated RTN values inside the file", () => {
    const analysis = analyze([
      HEADER,
      ["", "PROVEEDOR UNO", "08011999000125", "Local", "", "", "", "", "", "", ""],
      ["", "PROVEEDOR DOS", "08011999000125", "Local", "", "", "", "", "", "", ""],
    ]);

    expect(analysis.errors.some(error => error.message.includes("RTN duplicado"))).toBe(true);
  });

  it("continues the generated sequence from existing suppliers", () => {
    const analysis = analyze(
      [
        HEADER,
        ["", "NUEVO PROVEEDOR", "08011999000126", "Local", "", "", "", "", "", "", ""],
      ],
      [
        {
          id: 10,
          supplierCode: "PROV-000010",
          rtn: "08011999000120",
          allowsTaxWithholding: true,
          subjectToAccountPayments: true,
        },
      ]
    );

    expect(analysis.rows[0]?.supplierCode).toBe("PROV-000011");
  });

  it("updates by existing RTN when code is empty", () => {
    const analysis = analyze(
      [
        HEADER,
        ["", "PROVEEDOR EXISTENTE", "08011999000127", "Local", "", "", "", "", "", "", ""],
      ],
      [
        {
          id: 7,
          supplierCode: "PROV-000020",
          rtn: "08011999000127",
          allowsTaxWithholding: false,
          subjectToAccountPayments: false,
        },
      ]
    );

    expect(analysis.rows[0]).toMatchObject({
      supplierCode: "PROV-000020",
      action: "update",
      existingSupplierId: 7,
      allowsTaxWithholding: false,
      subjectToAccountPayments: false,
    });
  });
});
