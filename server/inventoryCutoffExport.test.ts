import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { InventoryCutoffReport } from "../shared/inventory-cutoff-report";
import {
  buildInventoryCutoffSheets,
  formatInventoryCutoffDate,
} from "../client/src/lib/inventory-cutoff-export";
import { buildWorkbook } from "../client/src/lib/excel-export";

function reportFixture(): InventoryCutoffReport {
  const stock = {
    sapItemCode: "010200003",
    description: "Artículo de prueba",
    brand: "MARCA",
    partNumber: "00023",
    category: "Insumos",
    unit: "gal",
    stock: 7,
    totalRequired: null,
    pendingReceipt: null,
    projectLabel: "017 - Proyecto",
    warehouseLabel: "Bodega 017",
    storageLocation: "A1",
    coverage: "documentary" as const,
    observations: "Saldo reconstruido con los documentos disponibles.",
  };
  return {
    cutoffDate: "2026-10-01",
    generatedAt: "2026-11-12T16:00:00Z",
    periodStartDate: "2026-09-22",
    timeZone: "America/Tegucigalpa",
    coverage: {
      kind: "documentary_partial",
      baselineDate: "2026-09-22",
      recordedFrom: "2026-11-12",
      recordedRows: 0,
      documentaryRows: 2,
      unavailableRows: 1,
      message: "Algunas ubicaciones no tienen información suficiente.",
      warnings: ["Los pendientes históricos no están disponibles."],
    },
    inventory: [
      stock,
      {
        ...stock,
        storageLocation: "B2",
        stock: null,
        coverage: "unavailable",
        observations: "No se puede comprobar el saldo en esta ubicación.",
      },
      { ...stock, storageLocation: "C3", stock: 0 },
    ],
    entries: [
      {
        receiptNumber: "REC-017-00001",
        invoiceDate: "",
        invoiceNumber: "",
        entryDate: "2026-10-01",
        projectLabel: stock.projectLabel,
        warehouseLabel: stock.warehouseLabel,
        documentType: "Traslado",
        destination: "Equipo de prueba",
        sapItemCode: stock.sapItemCode,
        itemName: stock.description,
        brand: stock.brand,
        partNumber: stock.partNumber,
        unit: stock.unit,
        quantity: 7,
        storageLocation: "A1",
        observations: "Origen TR-017-00001.",
      },
    ],
    exits: [
      {
        exitNumber: "SAL-017-00001",
        exitDate: "2026-09-30",
        ownerProjectLabel: stock.projectLabel,
        requestingProjectLabel: "018 - Proyecto solicitante",
        warehouseLabel: stock.warehouseLabel,
        destination: "Equipo de prueba",
        sapItemCode: stock.sapItemCode,
        itemName: stock.description,
        unit: stock.unit,
        quantity: 2,
        reference: "REQ-018-00001",
        storageLocation: "B2",
        observations: "Salida documentada.",
      },
    ],
  };
}

function workbook() {
  return buildWorkbook(XLSX, buildInventoryCutoffSheets(reportFixture()));
}

describe("exportación de inventario a fecha de corte", () => {
  it("conserva las tres hojas y los 37 encabezados originales", () => {
    const sheets = buildInventoryCutoffSheets(reportFixture());
    expect(sheets.map(sheet => sheet.sheetName)).toEqual([
      "Inventario",
      "Recepcion_Bodega",
      "Salida_de_Inventario",
    ]);
    expect(sheets[0].columns.map(column => column.header)).toEqual([
      "Código SAP",
      "Descripción",
      "Marca",
      "No. parte",
      "Categoría",
      "Unidad",
      "Stock",
      "Total requeridas",
      "Por recibirse",
      "Proyecto / bodega",
      "Almacén físico",
      "Ubicación",
      "Observaciones",
    ]);
    expect(sheets[1].columns.map(column => column.header)).toEqual([
      "No Recepcion",
      "Fecha Factura",
      "No Factura:",
      "Fecha Ingreso",
      "Job o Proyecto",
      "Bodega Ingreso",
      "Tipo Documento",
      "Destino",
      "Código Empresa",
      "Artículo recibido",
      "Marca",
      "No. Partes",
      "U.M.",
      "Cantidad",
      "Ubicación",
      "Observaciones",
    ]);
    expect(sheets[2].columns.map(column => column.header)).toEqual([
      "No. Salida Bodega",
      "Fecha Salida",
      "Job Dueño Stock",
      "Proyecto Solicitante",
      "Almacén físico:",
      "Destino",
      "Codigo Empresa",
      "Identificador",
      "U.M.",
      "Cantidad",
      "Referencia",
      "Ubicación",
      "Observaciones",
    ]);
  });

  it("mantiene separados los estantes y no descarta cantidades cero", () => {
    const rows = XLSX.utils.sheet_to_json(workbook().Sheets.Inventario);
    expect(rows).toHaveLength(3);
    expect(rows).toMatchObject([
      { Ubicación: "A1", Stock: 7 },
      { Ubicación: "B2", Stock: "N/D" },
      { Ubicación: "C3", Stock: 0 },
    ]);
  });

  it("distingue información histórica no disponible de un cero confirmado", () => {
    const sheet = workbook().Sheets.Inventario;
    expect(sheet.G2).toMatchObject({ t: "n", v: 7 });
    expect(sheet.G3).toMatchObject({ t: "s", v: "N/D" });
    expect(sheet.G4).toMatchObject({ t: "n", v: 0 });
    expect(sheet.H2.v).toBe("N/D");
    expect(sheet.I2.v).toBe("N/D");
  });

  it("conserva los códigos con ceros iniciales al escribir y volver a leer XLSX", () => {
    const saved = XLSX.write(workbook(), { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(saved, { type: "buffer" });
    expect(restored.Sheets.Inventario.A2).toMatchObject({
      t: "s",
      v: "010200003",
    });
    expect(restored.Sheets.Inventario.D2).toMatchObject({ t: "s", v: "00023" });
    expect(restored.Sheets.Recepcion_Bodega.I2).toMatchObject({
      t: "s",
      v: "010200003",
    });
    expect(restored.Sheets.Salida_de_Inventario.G2).toMatchObject({
      t: "s",
      v: "010200003",
    });
    expect(restored.Sheets.Recepcion_Bodega.N2).toMatchObject({ t: "n", v: 7 });
  });

  it("muestra los pendientes actuales una vez sin confundir referencias con N/D", () => {
    const report = reportFixture();
    report.inventory[0].totalRequired = 12;
    report.inventory[0].pendingReceipt = 4;
    report.inventory[1].pendingReferenceOnly = true;
    const sheet = buildWorkbook(XLSX, buildInventoryCutoffSheets(report)).Sheets
      .Inventario;
    expect(sheet.H2.v).toBe(12);
    expect(sheet.I2.v).toBe(4);
    expect(sheet.H3.v).toBe("");
    expect(sheet.I3.v).toBe("");
    expect(sheet.H4.v).toBe("N/D");
    expect(sheet.I4.v).toBe("N/D");
  });

  it("incluye corte, alcance y observaciones en las tres hojas", () => {
    const sheets = workbook().Sheets;
    for (const cell of [
      sheets.Inventario.M2,
      sheets.Recepcion_Bodega.P2,
      sheets.Salida_de_Inventario.M2,
    ]) {
      expect(cell.v).toContain("Corte: 01/10/2026 (Honduras)");
      expect(cell.v).toContain("22/09/2026");
      expect(cell.v).toContain("Reconstrucción documental parcial");
      expect(cell.v).toContain(
        "Los pendientes históricos no están disponibles"
      );
    }
    expect(sheets.Inventario.M3.v).toContain("Stock N/D");
    expect(sheets.Recepcion_Bodega.P2.v).toContain("Origen TR-017-00001");
  });

  it("no inventa datos de factura para una entrada por traslado", () => {
    const sheet = workbook().Sheets.Recepcion_Bodega;
    expect(sheet.B2.v).toBe("");
    expect(sheet.C2.v).toBe("");
    expect(sheet.D2.v).toBe("01/10/2026");
    expect(sheet.O2.v).toBe("A1");
  });

  it("incluye el contexto global una vez por hoja y conserva las observaciones por fila", () => {
    const report = reportFixture();
    report.entries.push({
      ...report.entries[0],
      receiptNumber: "REC-017-00002",
      observations: "Segunda entrada.",
    });
    report.exits.push({
      ...report.exits[0],
      exitNumber: "SAL-017-00002",
      observations: "Segunda salida.",
    });
    const sheets = buildWorkbook(
      XLSX,
      buildInventoryCutoffSheets(report)
    ).Sheets;
    for (const cell of [
      sheets.Inventario.M2,
      sheets.Recepcion_Bodega.P2,
      sheets.Salida_de_Inventario.M2,
    ]) {
      expect(cell.v).toContain("Corte: 01/10/2026 (Honduras)");
      expect(cell.v).toContain(report.coverage.message);
      expect(cell.v).toContain(report.coverage.warnings[0]);
    }
    for (const cell of [
      sheets.Inventario.M3,
      sheets.Recepcion_Bodega.P3,
      sheets.Salida_de_Inventario.M3,
    ]) {
      expect(cell.v).not.toContain("Corte:");
      expect(cell.v).not.toContain(report.coverage.message);
      expect(cell.v).not.toContain(report.coverage.warnings[0]);
    }
    expect(sheets.Inventario.M3.v).toContain("Stock N/D");
    expect(sheets.Inventario.M3.v).toContain(report.inventory[1].observations);
    expect(sheets.Recepcion_Bodega.P3.v).toBe("Segunda entrada.");
    expect(sheets.Salida_de_Inventario.M3.v).toBe("Segunda salida.");
  });

  it("respeta fechas sin hora y convierte instantes a la fecha de Honduras", () => {
    expect(formatInventoryCutoffDate("2026-10-01")).toBe("01/10/2026");
    expect(formatInventoryCutoffDate("2026-10-01T02:00:00Z")).toBe(
      "30/09/2026"
    );
    expect(formatInventoryCutoffDate("")).toBe("");
  });
});
